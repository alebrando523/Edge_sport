// api/polymarket.js — recupera eventi da Polymarket (API pubblica, no chiave necessaria)

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const { sport } = req.query;

  // Mappatura sport → tag Polymarket
  const tagMap = {
    soccer: 'soccer',
    basketball: 'nba',
    tennis: 'tennis',
    football: 'nfl',
  };

  const tag = tagMap[sport] || 'soccer';

  try {
    const response = await fetch(
      `https://gamma-api.polymarket.com/events?tag_slug=${tag}&limit=40&active=true&closed=false`
    );

    if (!response.ok) {
      throw new Error(`Polymarket API error: ${response.status}`);
    }

    const rawData = await response.json();
    const rawEvents = Array.isArray(rawData) ? rawData : (rawData.events || []);

    // Normalizza gli eventi Polymarket
    const events = rawEvents
      .filter(e => e.markets?.length > 0)
      .map(e => {
        // Cerca il mercato principale (win/lose, home/away, 1X2)
        const mainMarket = e.markets.find(m =>
          m.outcomes && m.outcomePrices &&
          m.outcomes.length >= 2
        );

        if (!mainMarket) return null;

        let outcomes = {};
        try {
          const names = typeof mainMarket.outcomes === 'string'
            ? JSON.parse(mainMarket.outcomes)
            : mainMarket.outcomes;
          const prices = typeof mainMarket.outcomePrices === 'string'
            ? JSON.parse(mainMarket.outcomePrices)
            : mainMarket.outcomePrices;

          names.forEach((name, i) => {
            outcomes[name] = parseFloat(prices[i]);
          });
        } catch {
          return null;
        }

        return {
          id: e.id,
          title: e.title || e.name,
          startDate: e.startDate || e.endDate,
          volume: e.volume || 0,
          outcomes, // { "Torino FC": 0.44, "Parma Calcio": 0.25, "Draw": 0.33 }
          marketId: mainMarket.id,
        };
      })
      .filter(Boolean);

    res.json(events);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
