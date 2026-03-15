// api/polymarket.js — recupera eventi da Polymarket (API pubblica, no chiave necessaria)

const SEASON_KEYWORDS = [
  'winner', 'champion', 'qualify', 'qualified', 'qualifies',
  'relegated', 'relegation', 'goalscorer', 'top scorer',
  'top 4', 'top 3', 'top 2', '1st place', '2nd place', '3rd place', 'last place',
  'will ', 'who will', 'which', 'most', 'mvp', 'award', 'promoted', 'promotion',
  'advance', 'season', 'cup winner', 'league winner', 'title',
];

function isSeasonMarket(title = '') {
  const t = title.toLowerCase();
  return SEASON_KEYWORDS.some(kw => t.includes(kw));
}

function isMatchMarket(title = '') {
  const t = title.toLowerCase();
  return t.includes(' vs ') || t.includes(' v ') || /\w+ [-] \w+/.test(t);
}

function parseMarketOutcomes(market) {
  try {
    const names = typeof market.outcomes === 'string'
      ? JSON.parse(market.outcomes)
      : market.outcomes;
    const prices = typeof market.outcomePrices === 'string'
      ? JSON.parse(market.outcomePrices)
      : market.outcomePrices;
    const outcomes = {};
    names.forEach((name, i) => {
      const price = parseFloat(prices[i]);
      if (!isNaN(price)) outcomes[name] = price;
    });
    return Object.keys(outcomes).length >= 2 ? outcomes : null;
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const { sport } = req.query;

  const tagMap = {
    soccer: ['soccer', 'football', 'epl', 'serie-a', 'champions-league', 'la-liga', 'bundesliga', 'ligue-1'],
    basketball: ['nba', 'basketball'],
    tennis: ['tennis'],
    football: ['nfl', 'american-football'],
  };

  const tags = tagMap[sport] || tagMap['soccer'];

  try {
    const allFetches = await Promise.all(
      tags.map(tag =>
        fetch(`https://gamma-api.polymarket.com/events?tag_slug=${tag}&limit=50&active=true&closed=false`)
          .then(r => r.ok ? r.json() : [])
          .catch(() => [])
      )
    );

    const rawEvents = allFetches.flat();

    const seen = new Set();
    const unique = rawEvents.filter(e => {
      if (!e?.id || seen.has(e.id)) return false;
      seen.add(e.id);
      return true;
    });

    const matchMarkets = [];
    const seasonMarkets = [];

    for (const e of unique) {
      if (!e.markets?.length) continue;
      const mainMarket = e.markets.find(m => m.outcomes && m.outcomePrices);
      if (!mainMarket) continue;
      const outcomes = parseMarketOutcomes(mainMarket);
      if (!outcomes) continue;

      const title = e.title || e.name || '';
      const event = {
        id: e.id,
        title,
        startDate: e.startDate || e.endDate,
        volume: parseFloat(e.volume || 0),
        outcomes,
        marketId: mainMarket.id,
        type: isMatchMarket(title) ? 'match' : isSeasonMarket(title) ? 'season' : 'other',
      };

      if (event.type === 'match') {
        matchMarkets.push(event);
      } else {
        seasonMarkets.push(event);
      }
    }

    res.json({ matchMarkets, seasonMarkets, total: unique.length });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
