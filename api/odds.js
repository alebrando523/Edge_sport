// api/odds.js — SureBet Scanner con Back/Lay arbitraggio
// Strategia principale: Back su bookmaker + Lay su Betfair Exchange
// Questo copre anche il calcio 1X2:
//   - Lay "Home" su Betfair = vinci se Draw o Away
//   - Back "Draw" su bookmaker + Lay "Draw" su Betfair = arb puro

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const API_KEY = process.env.ODDS_API_KEY;
  if (!API_KEY) return res.status(500).json({ error: 'ODDS_API_KEY mancante' });

  const startTime = Date.now();

  try {
    // 1. Lista sport attivi
    const sportsRes = await fetch(
      `https://api.the-odds-api.com/v4/sports/?apiKey=${API_KEY}`
    );
    if (!sportsRes.ok) throw new Error(`Sports API: ${sportsRes.status}`);
    const sportsList = await sportsRes.json();

    const EXCLUDE_GROUPS = ['Golf', 'Motorsport', 'Cycling', 'Athletics', 'Aussie Rules'];
    const PRIORITY_GROUPS = ['Soccer', 'Tennis', 'Basketball', 'Ice Hockey', 'Baseball',
      'Mixed Martial Arts', 'American Football', 'Rugby Union', 'Rugby League', 'Cricket', 'Darts'];

    const activeSports = sportsList
      .filter(s => s.active && !EXCLUDE_GROUPS.includes(s.group))
      .sort((a, b) => {
        const pa = PRIORITY_GROUPS.indexOf(a.group);
        const pb = PRIORITY_GROUPS.indexOf(b.group);
        return (pa === -1 ? 99 : pa) - (pb === -1 ? 99 : pb);
      });

    const allKeys = activeSports.map(s => s.key);
    let lastUsed = null, lastRemaining = null;

    // 2. Fetch quote — includiamo h2h_lay per ottenere le quote LAY di Betfair
    // markets=h2h include automaticamente h2h_lay per Betfair Exchange
    const fetchResults = await Promise.allSettled(
      allKeys.map(key =>
        fetch(
          `https://api.the-odds-api.com/v4/sports/${key}/odds/` +
          `?apiKey=${API_KEY}&regions=eu,uk&markets=h2h&oddsFormat=decimal`
        ).then(async r => {
          lastUsed = r.headers.get('x-requests-used') || lastUsed;
          lastRemaining = r.headers.get('x-requests-remaining') || lastRemaining;
          if (!r.ok) return { key, events: [] };
          const data = await r.json();
          return { key, events: Array.isArray(data) ? data : [] };
        }).catch(() => ({ key, events: [] }))
      )
    );

    // 3. Processa ogni evento
    const allEvents = [];
    const filterStats = {
      total: 0, noBookmakers: 0, noLayOdds: 0,
      withDraw: 0, passed: 0, passedWithDraw: 0
    };

    for (const result of fetchResults) {
      if (result.status !== 'fulfilled') continue;
      const { key, events } = result.value;

      for (const ev of events) {
        filterStats.total++;
        if (!ev?.bookmakers?.length) { filterStats.noBookmakers++; continue; }

        // Raccogli le migliori quote BACK da tutti i bookmaker (escluso Betfair)
        const bestBack = {};  // { outcome: { quota, bookmaker } }
        // Raccogli quote LAY da Betfair Exchange
        const betfairLay = {};  // { outcome: { quota } }
        // Raccogli quote BACK anche da Betfair (per calcolare commissione)
        const betfairBack = {}; // { outcome: { quota } }

        for (const bk of ev.bookmakers) {
          const isBetfair = bk.key === 'betfair_ex_eu' || bk.key === 'betfair_ex_uk';

          // Quote BACK
          const h2h = bk.markets?.find(m => m.key === 'h2h');
          if (h2h) {
            for (const outcome of h2h.outcomes) {
              if (isBetfair) {
                betfairBack[outcome.name] = { quota: outcome.price };
              } else {
                const cur = bestBack[outcome.name];
                if (!cur || outcome.price > cur.quota) {
                  bestBack[outcome.name] = { quota: outcome.price, bookmaker: bk.title };
                }
              }
            }
          }

          // Quote LAY (solo Betfair Exchange)
          if (isBetfair) {
            const h2hLay = bk.markets?.find(m => m.key === 'h2h_lay');
            if (h2hLay) {
              for (const outcome of h2hLay.outcomes) {
                betfairLay[outcome.name] = { quota: outcome.price };
              }
            }
          }
        }

        // Verifica che abbiamo quote LAY da Betfair
        const hasLay = Object.keys(betfairLay).length > 0;
        // Se non abbiamo LAY, usiamo le quote BACK di Betfair come proxy
        const layOdds = hasLay ? betfairLay : betfairBack;

        if (Object.keys(layOdds).length === 0) {
          filterStats.noLayOdds++;
          continue;
        }

        const hasDraw = Object.keys(bestBack).some(k => k.toLowerCase() === 'draw') ||
                        Object.keys(layOdds).some(k => k.toLowerCase() === 'draw');

        // Calcola arb back/lay per ogni outcome
        // Commissione Betfair standard: 5%
        const BETFAIR_COMMISSION = 0.05;

        const backLayOpps = [];

        for (const [outcome, backData] of Object.entries(bestBack)) {
          const layData = layOdds[outcome];
          if (!layData) continue;

          const backOdds = backData.quota;
          const layOdds_ = layData.quota;

          // ── CALCOLO CORRETTO BACK/LAY ──────────────────────────────────
          // Condizione necessaria per arb: backOdds > layOdds (SEMPRE, prima di comm.)
          // La commissione si applica solo ai guadagni del lay (quando back perde).
          //
          // Se back VINCE:  profit = stakeBack×(backOdds-1) - stakeLay×(layOdds-1)
          // Se back PERDE:  profit = stakeLay×(1-comm) - stakeBack
          //
          // Stake ottimali per profitto uguale in entrambi i casi:
          //   stakeBack × backOdds = stakeLay × layOdds  →  equalized liability
          //   stakeBack = budget / backOdds
          //   stakeLay  = budget / layOdds
          //
          // Profitto per unità di budget:
          //   winProfit  = (backOdds-1)/backOdds - (layOdds-1)/layOdds
          //   loseProfit = (1-comm)/layOdds - 1/backOdds
          //
          // È un arb reale solo se ENTRAMBI i profitti sono positivi.

          const stakeBackUnit = 1 / backOdds;
          const stakeLayUnit  = 1 / layOdds_;

          const winProfit  = (backOdds - 1) * stakeBackUnit - (layOdds_ - 1) * stakeLayUnit;
          const loseProfit = stakeLayUnit * (1 - BETFAIR_COMMISSION) - stakeBackUnit;

          const minProfit = Math.min(winProfit, loseProfit);
          const isArb = minProfit > 0;
          // Percentuale rispetto al budget (backStake = 1/backOdds del budget)
          const profitPct = minProfit * backOdds * 100;

          // Gap: quanto manca per diventare arb (negativo = perdita)
          const gap = profitPct;

          backLayOpps.push({
            outcome,
            backOdds,
            backBookmaker: backData.bookmaker,
            layOdds: layOdds_,
            layOddsAdj: parseFloat(layOdds_.toFixed(4)), // mantenuto per compatibilità UI
            isArb,
            margin: parseFloat((1 - minProfit).toFixed(4)),
            profit: parseFloat(gap.toFixed(2)),
            winProfit:  parseFloat((winProfit  * 100).toFixed(2)),
            loseProfit: parseFloat((loseProfit * 100).toFixed(2)),
            usedLayOdds: hasLay ? 'lay' : 'back_proxy',
          });
        }

        if (backLayOpps.length === 0) continue;

        // Calcola anche spread tra bookmaker (Back/Back)
        const allBackOdds = {};
        for (const bk of ev.bookmakers) {
          if (bk.key === 'betfair_ex_eu' || bk.key === 'betfair_ex_uk') continue;
          const h2h = bk.markets?.find(m => m.key === 'h2h');
          if (!h2h) continue;
          for (const outcome of h2h.outcomes) {
            if (!allBackOdds[outcome.name]) allBackOdds[outcome.name] = [];
            allBackOdds[outcome.name].push({ bookmaker: bk.title, quota: outcome.price });
          }
        }

        const spread = {};
        for (const [team, odds] of Object.entries(allBackOdds)) {
          const quotas = odds.map(o => o.quota);
          const max = Math.max(...quotas);
          const min = Math.min(...quotas);
          spread[team] = {
            max, min,
            spreadPct: ((max - min) / min * 100).toFixed(2),
            allOdds: [...odds].sort((a, b) => b.quota - a.quota),
          };
        }

        const bestOpportunity = [...backLayOpps].sort((a, b) => b.profit - a.profit)[0];

        filterStats.passed++;
        if (hasDraw) filterStats.passedWithDraw++;

        allEvents.push({
          id: ev.id,
          sport: ev.sport_key,
          sportTitle: ev.sport_title,
          homeTeam: ev.home_team,
          awayTeam: ev.away_team,
          commenceTime: ev.commence_time,
          hasDraw,
          bookmakerCount: ev.bookmakers.length,
          hasRealLay: hasLay,
          backLayOpps,          // tutte le opportunità back/lay per ogni esito
          bestOpportunity,      // la migliore in assoluto
          spread,               // spread back/back tra bookmaker
          betfairLay,           // quote lay grezze Betfair
        });
      }
    }

    // Ordina per profitto migliore
    allEvents.sort((a, b) => b.bestOpportunity.profit - a.bestOpportunity.profit);

    // Stats per sport
    const sportStats = {};
    for (const ev of allEvents) {
      if (!sportStats[ev.sport]) sportStats[ev.sport] = { title: ev.sportTitle, count: 0 };
      sportStats[ev.sport].count++;
    }

    const allSportsActive = activeSports.map(s => ({
      key: s.key, title: s.title, group: s.group
    }));

    const elapsed = Date.now() - startTime;
    console.log(`${elapsed}ms — ${allEvents.length} eventi (${filterStats.passedWithDraw} calcio 1X2)`);

    res.json({
      events: allEvents,
      sportStats,
      allSportsActive,
      filterStats,
      totalScanned: allKeys.length,
      elapsed,
      apiUsage: {
        used: parseInt(lastUsed || 0),
        remaining: parseInt(lastRemaining || 500),
      },
    });

  } catch (error) {
    console.error(error.message);
    res.status(500).json({ error: error.message });
  }
}
