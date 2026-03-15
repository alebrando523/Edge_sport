// api/odds.js — recupera quote da The Odds API su tutti i mercati binari

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const API_KEY = process.env.ODDS_API_KEY;
  if (!API_KEY) {
    return res.status(500).json({ error: 'ODDS_API_KEY non configurata nelle variabili Vercel' });
  }

  // ─── SPORT BINARI AL 100% (nessun pareggio possibile strutturalmente) ───────
  const BINARY_SPORT_KEYS = [
    // Tennis — tutti i tornei attivi
    // (recuperati dinamicamente sotto)

    // Basket
    'basketball_nba',
    'basketball_euroleague',

    // Football americano
    'americanfootball_nfl',

    // Baseball
    'baseball_mlb',

    // Hockey su ghiaccio (NHL — overtime/shootout garantisce vincitore)
    'icehockey_nhl',

    // MMA / Boxe
    'mma_mixed_martial_arts',

    // Calcio KNOCKOUT (eliminazione diretta — no pareggio ai tempi regolamentari)
    'soccer_uefa_champs_league',
    'soccer_uefa_europa_league',
    'soccer_uefa_conference_league',
    'soccer_italy_coppa_italia',
    'soccer_spain_copa_del_rey',
    'soccer_germany_dfb_pokal',
    'soccer_england_league_cup',
    'soccer_france_coupe_de_france',
    'soccer_fifa_world_cup',
    'soccer_uefa_european_championship',

    // Mercati non sportivi disponibili sui bookmaker
    'politics_us_presidential_election_winner',
    'politics_us',
  ];

  try {
    // Recupera lista sport attivi per prendere tutti i tornei di tennis
    const sportsRes = await fetch(`https://api.the-odds-api.com/v4/sports/?apiKey=${API_KEY}`);
    if (!sportsRes.ok) throw new Error('Errore recupero lista sport');
    const sportsList = await sportsRes.json();

    const tennisKeys = sportsList
      .filter(s => s.group === 'Tennis' && s.active)
      .map(s => s.key)
      .slice(0, 6);

    const allKeys = [...new Set([...BINARY_SPORT_KEYS, ...tennisKeys])];

    let lastUsed = null;
    let lastRemaining = null;

    // Fetch parallelo — max 10 alla volta per non saturare
    const chunks = [];
    for (let i = 0; i < allKeys.length; i += 10) {
      chunks.push(allKeys.slice(i, i + 10));
    }

    const allEvents = [];
    for (const chunk of chunks) {
      const results = await Promise.all(
        chunk.map(key =>
          fetch(
            `https://api.the-odds-api.com/v4/sports/${key}/odds/?apiKey=${API_KEY}&regions=eu&markets=h2h&oddsFormat=decimal`
          )
            .then(r => {
              if (r.ok) {
                lastUsed = r.headers.get('x-requests-used') || lastUsed;
                lastRemaining = r.headers.get('x-requests-remaining') || lastRemaining;
                return r.json();
              }
              return [];
            })
            .catch(() => [])
        )
      );

      for (const events of results) {
        if (!Array.isArray(events)) continue;
        for (const e of events) {
          if (!e?.id || !e.bookmakers?.length) continue;

          // Prendi le migliori quote tra tutti i bookmaker
          const bestOutcomes = {};
          for (const bk of e.bookmakers) {
            const h2h = bk.markets?.find(m => m.key === 'h2h');
            if (!h2h) continue;
            for (const outcome of h2h.outcomes) {
              if (!bestOutcomes[outcome.name] || outcome.price > bestOutcomes[outcome.name]) {
                bestOutcomes[outcome.name] = outcome.price;
              }
            }
          }

          // Scarta eventi con pareggio — devono essere strettamente binari
          const hasDraw = Object.keys(bestOutcomes).some(k =>
            k.toLowerCase() === 'draw' || k.toLowerCase() === 'x'
          );
          if (hasDraw) continue;

          // Deve avere esattamente 2 esiti
          if (Object.keys(bestOutcomes).length !== 2) continue;

          allEvents.push({
            id: e.id,
            sport: e.sport_key,
            sportGroup: e.sport_title,
            homeTeam: e.home_team,
            awayTeam: e.away_team,
            commenceTime: e.commence_time,
            outcomes: bestOutcomes,
          });
        }
      }
    }

    res.json({
      events: allEvents,
      apiUsage: {
        used: parseInt(lastUsed || 0),
        remaining: parseInt(lastRemaining || 500),
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
