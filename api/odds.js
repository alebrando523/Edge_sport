// api/odds.js — recupera quote da The Odds API
// Richiede variabile d'ambiente: ODDS_API_KEY

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const { sport } = req.query;
  const API_KEY = process.env.ODDS_API_KEY;

  if (!API_KEY) {
    return res.status(500).json({ error: 'ODDS_API_KEY non configurata nelle variabili Vercel' });
  }

  // Mappatura sport → chiavi API
  const sportKeyMap = {
    soccer: [
      'soccer_italy_serie_a',
      'soccer_epl',
      'soccer_spain_la_liga',
      'soccer_uefa_champs_league',
      'soccer_germany_bundesliga',
      'soccer_france_ligue_one',
    ],
    basketball: [
      'basketball_nba',
    ],
    tennis: null, // gestito dinamicamente
    football: [
      'americanfootball_nfl',
    ],
  };

  try {
    let sportKeys = sportKeyMap[sport];

    // Per il tennis recuperiamo prima i tornei attivi
    if (sport === 'tennis') {
      const sportsRes = await fetch(
        `https://api.the-odds-api.com/v4/sports/?apiKey=${API_KEY}`
      );
      if (!sportsRes.ok) throw new Error('Errore recupero lista sport');
      const sportsData = await sportsRes.json();
      sportKeys = sportsData
        .filter(s => s.group === 'Tennis' && s.active)
        .map(s => s.key)
        .slice(0, 4); // max 4 tornei per limitare le richieste
    }

    if (!sportKeys || sportKeys.length === 0) {
      return res.json([]);
    }

    // Fetch parallelo per tutti i campionati/tornei
    const results = await Promise.all(
      sportKeys.map(key =>
        fetch(
          `https://api.the-odds-api.com/v4/sports/${key}/odds/?apiKey=${API_KEY}&regions=eu&markets=h2h&oddsFormat=decimal`
        )
          .then(r => r.ok ? r.json() : [])
          .catch(() => [])
      )
    );

    // Normalizza e unisci tutti gli eventi
    const allEvents = results
      .flat()
      .filter(e => e && e.id && e.bookmakers?.length > 0)
      .map(e => {
        // Trova le migliori quote disponibili tra tutti i bookmaker
        const allOutcomes = {};
        for (const bk of e.bookmakers) {
          const h2h = bk.markets?.find(m => m.key === 'h2h');
          if (!h2h) continue;
          for (const outcome of h2h.outcomes) {
            if (!allOutcomes[outcome.name] || outcome.price > allOutcomes[outcome.name]) {
              allOutcomes[outcome.name] = outcome.price;
            }
          }
        }

        return {
          id: e.id,
          sport: e.sport_key,
          homeTeam: e.home_team,
          awayTeam: e.away_team,
          commenceTime: e.commence_time,
          outcomes: allOutcomes, // { "Torino": 2.15, "Parma": 3.90, "Draw": 2.95 }
        };
      });

    res.json(allEvents);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
