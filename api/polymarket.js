// api/polymarket.js — recupera tutti i mercati binari da Polymarket

const SEASON_KEYWORDS = [
  'which clubs', 'top goalscorer', 'top scorer', 'most clean', 'most assists',
  'top 4 finish', 'top 3 finish', '2nd place', '3rd place', 'last place',
  'get relegated', 'relegation', 'be promoted', 'promotion',
  'more markets', // link aggregatori da escludere
];

function isAggregator(title = '') {
  return title.toLowerCase().includes('more markets');
}

function isSeasonMarket(title = '') {
  const t = title.toLowerCase();
  return SEASON_KEYWORDS.some(kw => t.includes(kw));
}

function parseMarketOutcomes(market) {
  try {
    const names = typeof market.outcomes === 'string'
      ? JSON.parse(market.outcomes)
      : market.outcomes;
    const prices = typeof market.outcomePrices === 'string'
      ? JSON.parse(market.outcomePrices)
      : market.outcomePrices;

    if (!names || !prices || names.length < 2) return null;

    const outcomes = {};
    names.forEach((name, i) => {
      const price = parseFloat(prices[i]);
      if (!isNaN(price)) outcomes[name] = price;
    });

    // Solo mercati strettamente binari (2 esiti)
    return Object.keys(outcomes).length === 2 ? outcomes : null;
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  // Tag da cercare su Polymarket — sport binari + eventi non sportivi
  const TAGS = [
    // Sport
    'nba', 'basketball',
    'nfl', 'american-football',
    'tennis', 'atp', 'wta',
    'mlb', 'baseball',
    'nhl', 'hockey',
    'mma', 'ufc', 'boxing',
    'epl', 'champions-league', 'soccer', 'football',
    // Non sportivi (disponibili anche su bookmaker)
    'politics', 'elections', 'crypto', 'finance', 'economics',
    'entertainment', 'awards', 'science', 'weather',
  ];

  try {
    // Fetch parallelo su tutti i tag (batch da 6)
    const allFetches = [];
    for (let i = 0; i < TAGS.length; i += 6) {
      const batch = TAGS.slice(i, i + 6);
      const batchResults = await Promise.all(
        batch.map(tag =>
          fetch(`https://gamma-api.polymarket.com/events?tag_slug=${tag}&limit=50&active=true&closed=false`)
            .then(r => r.ok ? r.json() : [])
            .catch(() => [])
        )
      );
      allFetches.push(...batchResults.flat());
    }

    // Deduplica per id
    const seen = new Set();
    const unique = allFetches.filter(e => {
      if (!e?.id || seen.has(e.id)) return false;
      seen.add(e.id);
      return true;
    });

    const matchMarkets = [];
    const seasonMarkets = [];

    for (const e of unique) {
      if (!e.markets?.length) continue;

      const title = e.title || e.name || '';

      // Escludi aggregatori "More Markets"
      if (isAggregator(title)) continue;

      const mainMarket = e.markets.find(m => m.outcomes && m.outcomePrices);
      if (!mainMarket) continue;

      const outcomes = parseMarketOutcomes(mainMarket);
      if (!outcomes) continue;

      const event = {
        id: e.id,
        title,
        startDate: e.startDate || e.endDate,
        volume: parseFloat(e.volume || 0),
        outcomes,
        marketId: mainMarket.id,
        tags: (e.tags || []).map(t => t.slug || t.label || t),
      };

      if (isSeasonMarket(title)) {
        seasonMarkets.push(event);
      } else {
        matchMarkets.push(event);
      }
    }

    // Ordina per volume decrescente
    matchMarkets.sort((a, b) => b.volume - a.volume);

    res.json({ matchMarkets, seasonMarkets, total: unique.length });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
