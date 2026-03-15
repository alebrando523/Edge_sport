import { useState, useEffect, useCallback } from 'react';

// ─── UTILITÀ ──────────────────────────────────────────────────────────────────

// Rimuove il margine del bookmaker e restituisce probabilità pure
function devigOdds(oddsMap) {
  const entries = Object.entries(oddsMap);
  const probs = entries.map(([k, v]) => [k, 1 / v]);
  const total = probs.reduce((s, [, p]) => s + p, 0);
  return Object.fromEntries(probs.map(([k, p]) => [k, p / total]));
}

// Suffissi e parole da rimuovere per la normalizzazione
const STRIP_WORDS = /\b(fc|calcio|afc|cf|sc|ac|ss|us|as|fk|bk|sk|cd|rcd|rc|sd|ud|ca|sv|vfb|vfl|rb|rbl|tsv|tsg|1899|1913|1905|1904|de|del|la|le|los|las|el|il|lo|lo|gli|le|will|win|beat|vs|v|the|to|who|which|advance|qualify|make|reach|league|cup|serie|premier|champions|bundesliga|ligue|eredivisie|primeira|superliga|united|city|real|club|sporting|atletico|athletico|athletic|borussia|internazionale|inter|dynamo|dinamo|lokomotiv|spartak|shakhtar|galatasaray|fenerbahce|besiktas|trabzonspor)\b/gi;

// Normalizza testo per il matching
function normalizeName(name = '') {
  return name
    .toLowerCase()
    .replace(STRIP_WORDS, ' ')
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Estrae token significativi (min 3 caratteri) da una stringa normalizzata
function tokens(str) {
  return normalizeName(str).split(' ').filter(t => t.length >= 3);
}

// Calcola quanti token di A sono contenuti in B
function tokenOverlap(a, b) {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.length === 0) return 0;
  const matches = ta.filter(t => tb.some(bt => bt.includes(t) || t.includes(bt)));
  return matches.length / ta.length;
}

// Prova a fare match tra un evento Odds API e un evento Polymarket
// Usa token overlap su titolo + outcomes Polymarket
function tryMatch(oddsEvent, polyEvent) {
  const title = polyEvent.title || '';
  const polyText = [title, ...Object.keys(polyEvent.outcomes || {})].join(' ');

  const homeScore = tokenOverlap(oddsEvent.homeTeam, polyText);
  const awayScore = tokenOverlap(oddsEvent.awayTeam, polyText);

  // Basta che una delle due squadre abbia overlap ≥ 50%
  return homeScore >= 0.5 || awayScore >= 0.5;
}

// Trova la chiave Polymarket che corrisponde a una chiave Odds API
function findPolyOutcome(polyOutcomes, oddsKey) {
  // Caso pareggio
  if (oddsKey.toLowerCase() === 'draw') {
    for (const [k, v] of Object.entries(polyOutcomes)) {
      const kl = k.toLowerCase();
      if (kl.includes('draw') || kl.includes('tie') || kl.includes('pareggio') || kl === 'x') {
        return { key: k, price: v };
      }
    }
    return null;
  }

  let bestKey = null;
  let bestScore = 0;

  for (const [k, v] of Object.entries(polyOutcomes)) {
    // Salta outcome pareggio
    const kl = k.toLowerCase();
    if (kl.includes('draw') || kl.includes('tie') || kl === 'x') continue;

    const score = Math.max(tokenOverlap(oddsKey, k), tokenOverlap(k, oddsKey));
    if (score > bestScore) {
      bestScore = score;
      bestKey = [k, v];
    }
  }

  return bestScore >= 0.4 && bestKey ? { key: bestKey[0], price: bestKey[1] } : null;
}

// Calcola edge: differenza tra prezzo Polymarket e probabilità reale
// Positivo = Polymarket sta pagando di più → opportunità per te
function calcEdge(polyPrice, realProb) {
  return ((polyPrice - realProb) * 100).toFixed(1);
}

// Formatta data italiana
function formatDate(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

// ─── DATI SPORT ──────────────────────────────────────────────────────────────

const SPORTS = [
  { id: 'soccer',     label: 'Calcio',   emoji: '⚽' },
  { id: 'basketball', label: 'Basket',   emoji: '🏀' },
  { id: 'tennis',     label: 'Tennis',   emoji: '🎾' },
  { id: 'football',   label: 'Football', emoji: '🏈' },
];

// ─── COMPONENTE PRINCIPALE ───────────────────────────────────────────────────

export default function App() {
  const [sport, setSport] = useState('soccer');
  const [oddsData, setOddsData] = useState([]);
  const [polyData, setPolyData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [edgeThreshold, setEdgeThreshold] = useState(3);
  const [polySeasonData, setPolySeasonData] = useState([]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [oddsRes, polyRes] = await Promise.all([
        fetch(`/api/odds?sport=${sport}`),
        fetch(`/api/polymarket?sport=${sport}`),
      ]);

      const [odds, poly] = await Promise.all([
        oddsRes.json(),
        polyRes.json(),
      ]);

      if (odds.error) throw new Error(`Odds API: ${odds.error}`);
      if (poly.error) throw new Error(`Polymarket: ${poly.error}`);

      setOddsData(Array.isArray(odds) ? odds : []);
      // Nuova struttura: { matchMarkets, seasonMarkets, total }
      if (poly.matchMarkets !== undefined) {
        setPolyData(poly.matchMarkets || []);
        setPolySeasonData(poly.seasonMarkets || []);
      } else {
        setPolyData(Array.isArray(poly) ? poly : []);
        setPolySeasonData([]);
      }
      setLastUpdate(new Date());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [sport]);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5 * 60 * 1000); // aggiorna ogni 5 min
    return () => clearInterval(interval);
  }, [fetchData]);

  // ─── MATCHING E CALCOLO EDGE ───────────────────────────────────────────────

  const matchedEvents = [];

  for (const polyEvent of polyData) {
    const oddsMatch = oddsData.find(e => tryMatch(e, polyEvent));

    if (!oddsMatch) continue;

    // Salta eventi con pareggio (campionati) — teniamo solo eliminazione diretta
    const hasDrawOption = Object.keys(oddsMatch.outcomes).some(k =>
      k.toLowerCase() === 'draw' || k.toLowerCase() === 'x'
    );
    if (hasDrawOption) continue;

    const realProbs = devigOdds(oddsMatch.outcomes);
    const comparisons = [];

    for (const [oddsKey, realProb] of Object.entries(realProbs)) {
      const polyMatch = findPolyOutcome(polyEvent.outcomes, oddsKey);
      if (!polyMatch) continue;

      const edge = parseFloat(calcEdge(polyMatch.price, realProb));
      comparisons.push({
        label: oddsKey,
        realProb: (realProb * 100).toFixed(1),
        polyPrice: (polyMatch.price * 100).toFixed(1),
        edge,
      });
    }

    if (comparisons.length > 0) {
      const maxEdge = Math.max(...comparisons.map(c => c.edge));
      matchedEvents.push({
        id: polyEvent.id,
        title: polyEvent.title,
        homeTeam: oddsMatch.homeTeam,
        awayTeam: oddsMatch.awayTeam,
        commenceTime: oddsMatch.commenceTime || polyEvent.startDate,
        volume: polyEvent.volume,
        comparisons,
        maxEdge,
      });
    }
  }

  // Ordina per edge massimo
  matchedEvents.sort((a, b) => b.maxEdge - a.maxEdge);

  const positiveEdgeCount = matchedEvents.filter(e => e.maxEdge >= edgeThreshold).length;

  // ─── RENDER ───────────────────────────────────────────────────────────────

  return (
    <div style={styles.root}>
      {/* Header */}
      <header style={styles.header}>
        <div style={styles.headerInner}>
          <div>
            <div style={styles.logo}>EDGE<span style={styles.logoAccent}>FINDER</span></div>
            <div style={styles.subtitle}>Arbitraggio Bookmaker ↔ Polymarket</div>
          </div>
          <div style={styles.headerRight}>
            {lastUpdate && (
              <div style={styles.lastUpdate}>
                Aggiornato: {lastUpdate.toLocaleTimeString('it-IT')}
              </div>
            )}
            <button onClick={fetchData} style={styles.refreshBtn} disabled={loading}>
              {loading ? '⟳ Caricamento…' : '⟳ Aggiorna'}
            </button>
          </div>
        </div>
      </header>

      <main style={styles.main}>

        {/* Sport Tabs */}
        <div style={styles.tabBar}>
          {SPORTS.map(s => (
            <button
              key={s.id}
              onClick={() => setSport(s.id)}
              style={{ ...styles.tab, ...(sport === s.id ? styles.tabActive : {}) }}
            >
              {s.emoji} {s.label}
            </button>
          ))}
        </div>

        {/* Filtro attivo */}
        <div style={styles.filterNote}>
          <span style={{ color: '#00ff88' }}>✓</span> Filtro attivo: solo eventi <strong>senza pareggio</strong> —
          {sport === 'soccer'
            ? ' Champions League, Europa League, Coppe nazionali'
            : sport === 'basketball'
            ? ' NBA (nessun pareggio possibile)'
            : sport === 'tennis'
            ? ' tutti i tornei (nessun pareggio possibile)'
            : ' NFL (nessun pareggio possibile)'}
        </div>

        {/* Controlli */}
        <div style={styles.controls}>
          <div style={styles.controlGroup}>
            <label style={styles.controlLabel}>Soglia edge minimo</label>
            <div style={styles.sliderRow}>
              <input
                type="range" min="0" max="15" step="0.5"
                value={edgeThreshold}
                onChange={e => setEdgeThreshold(parseFloat(e.target.value))}
                style={styles.slider}
              />
              <span style={styles.sliderValue}>{edgeThreshold}%</span>
            </div>
          </div>
          <div style={styles.stats}>
            <div style={styles.statBox}>
              <span style={styles.statNum}>{matchedEvents.length}</span>
              <span style={styles.statLabel}>eventi abbinati</span>
            </div>
            <div style={styles.statBox}>
              <span style={{ ...styles.statNum, color: '#00ff88' }}>{positiveEdgeCount}</span>
              <span style={styles.statLabel}>con edge ≥ {edgeThreshold}%</span>
            </div>
            <div style={styles.statBox}>
              <span style={styles.statNum}>{polyData.length}</span>
              <span style={styles.statLabel}>partite Polymarket</span>
            </div>
            <div style={styles.statBox}>
              <span style={{ ...styles.statNum, color: '#666688' }}>{polySeasonData.length}</span>
              <span style={styles.statLabel}>mercati stagionali</span>
            </div>
            <div style={styles.statBox}>
              <span style={styles.statNum}>{oddsData.length}</span>
              <span style={styles.statLabel}>eventi Bookmaker</span>
            </div>
          </div>
        </div>

        {/* Errore */}
        {error && (
          <div style={styles.errorBox}>
            ⚠ {error}
            {error.includes('ODDS_API_KEY') && (
              <div style={{ marginTop: 8, fontSize: 12, opacity: 0.8 }}>
                Registrati su <strong>the-odds-api.com</strong> e aggiungi la chiave nelle variabili Vercel come <code>ODDS_API_KEY</code>
              </div>
            )}
          </div>
        )}

        {/* Loading */}
        {loading && matchedEvents.length === 0 && (
          <div style={styles.loadingBox}>
            <div style={styles.spinner} />
            Recupero dati da Bookmaker e Polymarket…
          </div>
        )}

        {/* Nessun risultato */}
        {!loading && !error && matchedEvents.length === 0 && (polyData.length > 0 || oddsData.length > 0) && (
          <div style={styles.emptyBox}>
            Nessun evento abbinato trovato tra Bookmaker e Polymarket per questo sport.
            <br /><small style={{ opacity: 0.5 }}>Controlla il pannello Debug qui sotto per vedere i titoli raw delle due API.</small>
          </div>
        )}

        {/* DEBUG PANEL */}
        {!loading && (polyData.length > 0 || oddsData.length > 0) && (
          <details style={{ ...styles.details, marginBottom: 16 }}>
            <summary style={styles.detailsSummary}>
              🔍 Debug — Titoli raw API (utile per capire perché il matching non funziona)
            </summary>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0 }}>
              <div>
                <div style={{ padding: '8px 16px', fontSize: 10, color: '#00ff88', letterSpacing: 1, borderBottom: '1px solid #1a1a2e' }}>
                  POLYMARKET PARTITE ({polyData.length}) + STAGIONALI ({polySeasonData.length})
                </div>
                <div style={{ ...styles.rawList, maxHeight: 200 }}>
                  {polyData.length === 0 && (
                    <div style={{ padding: '8px 16px', color: '#ff5555', fontSize: 11 }}>
                      ⚠ Nessuna partita singola trovata su Polymarket per questo sport
                    </div>
                  )}
                  {polyData.map(e => (
                    <div key={e.id} style={styles.rawItem}>
                      <span style={{ color: '#00ff88', fontSize: 11 }}>⚡ {e.title}</span>
                    </div>
                  ))}
                  {polySeasonData.slice(0, 15).map(e => (
                    <div key={e.id} style={styles.rawItem}>
                      <span style={{ color: '#666688', fontSize: 11 }}>📅 {e.title}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div style={{ borderLeft: '1px solid #1a1a2e' }}>
                <div style={{ padding: '8px 16px', fontSize: 10, color: '#4488ff', letterSpacing: 1, borderBottom: '1px solid #1a1a2e' }}>
                  BOOKMAKER ({oddsData.length} eventi)
                </div>
                <div style={{ ...styles.rawList, maxHeight: 200 }}>
                  {oddsData.slice(0, 30).map(e => (
                    <div key={e.id} style={styles.rawItem}>
                      <span style={{ color: '#a0a0c0', fontSize: 11 }}>{e.homeTeam} vs {e.awayTeam}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </details>
        )}

        {/* Event Cards */}
        <div style={styles.eventGrid}>
          {matchedEvents.map(event => (
            <EventCard
              key={event.id}
              event={event}
              threshold={edgeThreshold}
            />
          ))}
        </div>

        {/* Elenco Polymarket non abbinati */}
        {polyData.length > 0 && (
          <details style={styles.details}>
            <summary style={styles.detailsSummary}>
              📋 Tutti gli eventi Polymarket ({polyData.length}) — inclusi quelli senza abbinamento
            </summary>
            <div style={styles.rawList}>
              {polyData.map(e => (
                <div key={e.id} style={styles.rawItem}>
                  <span style={{ color: '#a0a0c0' }}>{e.title}</span>
                  <span style={{ color: '#444466', fontSize: 11 }}>
                    Vol: ${parseFloat(e.volume || 0).toLocaleString('it-IT', { maximumFractionDigits: 0 })}
                  </span>
                </div>
              ))}
            </div>
          </details>
        )}

      </main>
    </div>
  );
}

// ─── EVENT CARD ──────────────────────────────────────────────────────────────

function EventCard({ event, threshold }) {
  const hasEdge = event.maxEdge >= threshold;

  return (
    <div style={{ ...styles.card, ...(hasEdge ? styles.cardHighlight : {}) }}>
      {hasEdge && <div style={styles.edgeBadge}>EDGE +{event.maxEdge}%</div>}

      <div style={styles.cardHeader}>
        <div style={styles.cardTitle}>{event.homeTeam} vs {event.awayTeam}</div>
        <div style={styles.cardMeta}>
          {event.commenceTime && (
            <span style={styles.metaItem}>🕐 {formatDate(event.commenceTime)}</span>
          )}
          {event.volume > 0 && (
            <span style={styles.metaItem}>
              💧 ${parseFloat(event.volume).toLocaleString('it-IT', { maximumFractionDigits: 0 })}
            </span>
          )}
        </div>
      </div>

      <div style={styles.tableHeader}>
        <span style={styles.col1}>Esito</span>
        <span style={styles.col2}>Prob. reale</span>
        <span style={styles.col2}>Polymarket</span>
        <span style={styles.col2}>Edge</span>
      </div>

      {event.comparisons.map((c, i) => {
        const edgeColor = c.edge >= threshold ? '#00ff88'
          : c.edge >= 0 ? '#88cc88'
          : '#ff5555';

        return (
          <div key={i} style={{
            ...styles.tableRow,
            background: c.edge >= threshold ? 'rgba(0,255,136,0.05)' : 'transparent',
          }}>
            <span style={styles.col1}>{c.label}</span>
            <span style={styles.col2mono}>{c.realProb}%</span>
            <span style={styles.col2mono}>{c.polyPrice}%</span>
            <span style={{ ...styles.col2mono, color: edgeColor, fontWeight: 600 }}>
              {c.edge > 0 ? '+' : ''}{c.edge}%
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ─── STILI ───────────────────────────────────────────────────────────────────

const styles = {
  root: {
    minHeight: '100vh',
    background: '#06060e',
    color: '#d0d0e8',
    fontFamily: "'JetBrains Mono', monospace",
  },
  header: {
    borderBottom: '1px solid #1a1a2e',
    padding: '20px 24px',
    background: '#080810',
    position: 'sticky',
    top: 0,
    zIndex: 10,
  },
  headerInner: {
    maxWidth: 1100,
    margin: '0 auto',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  logo: {
    fontFamily: "'Syne', sans-serif",
    fontSize: 24,
    fontWeight: 800,
    letterSpacing: 4,
    color: '#ffffff',
  },
  logoAccent: { color: '#00ff88' },
  subtitle: { fontSize: 11, color: '#4a4a6a', marginTop: 2, letterSpacing: 1 },
  headerRight: { display: 'flex', alignItems: 'center', gap: 16 },
  lastUpdate: { fontSize: 11, color: '#4a4a6a' },
  refreshBtn: {
    background: 'transparent',
    border: '1px solid #2a2a4a',
    color: '#a0a0c0',
    padding: '6px 14px',
    borderRadius: 4,
    cursor: 'pointer',
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 12,
    transition: 'all 0.2s',
  },
  main: {
    maxWidth: 1100,
    margin: '0 auto',
    padding: '24px 16px',
  },
  tabBar: {
    display: 'flex',
    gap: 8,
    marginBottom: 24,
    flexWrap: 'wrap',
  },
  tab: {
    background: 'transparent',
    border: '1px solid #1a1a2e',
    color: '#6060a0',
    padding: '8px 18px',
    borderRadius: 4,
    cursor: 'pointer',
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 13,
    transition: 'all 0.15s',
  },
  tabActive: {
    background: '#0d0d1e',
    border: '1px solid #00ff88',
    color: '#00ff88',
  },
  controls: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
    gap: 16,
    flexWrap: 'wrap',
    background: '#0a0a18',
    padding: '14px 20px',
    borderRadius: 6,
    border: '1px solid #1a1a2e',
  },
  controlGroup: { display: 'flex', flexDirection: 'column', gap: 6 },
  controlLabel: { fontSize: 11, color: '#4a4a6a', letterSpacing: 1 },
  sliderRow: { display: 'flex', alignItems: 'center', gap: 12 },
  slider: { accentColor: '#00ff88', width: 140, cursor: 'pointer' },
  sliderValue: { fontSize: 14, color: '#00ff88', fontWeight: 600, minWidth: 36 },
  stats: { display: 'flex', gap: 20, flexWrap: 'wrap' },
  statBox: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 },
  statNum: { fontSize: 22, fontWeight: 600, color: '#e0e0f0', lineHeight: 1 },
  statLabel: { fontSize: 10, color: '#4a4a6a', letterSpacing: 0.5 },
  errorBox: {
    background: 'rgba(255,80,80,0.08)',
    border: '1px solid rgba(255,80,80,0.3)',
    borderRadius: 6,
    padding: '14px 18px',
    color: '#ff8888',
    fontSize: 13,
    marginBottom: 20,
  },
  loadingBox: {
    display: 'flex',
    alignItems: 'center',
    gap: 14,
    color: '#4a4a6a',
    fontSize: 13,
    padding: '40px 0',
    justifyContent: 'center',
  },
  spinner: {
    width: 18,
    height: 18,
    border: '2px solid #1a1a2e',
    borderTop: '2px solid #00ff88',
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
  },
  emptyBox: {
    textAlign: 'center',
    color: '#3a3a6a',
    fontSize: 14,
    padding: '48px 20px',
    lineHeight: 1.8,
  },
  eventGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(480px, 1fr))',
    gap: 14,
    marginBottom: 32,
  },
  card: {
    background: '#0a0a18',
    border: '1px solid #1a1a2e',
    borderRadius: 8,
    padding: '16px 18px',
    position: 'relative',
    transition: 'border-color 0.2s',
  },
  cardHighlight: {
    border: '1px solid rgba(0,255,136,0.3)',
    background: '#090916',
  },
  edgeBadge: {
    position: 'absolute',
    top: -1,
    right: 16,
    background: '#00ff88',
    color: '#000',
    fontSize: 10,
    fontWeight: 700,
    padding: '2px 8px',
    borderRadius: '0 0 6px 6px',
    letterSpacing: 1,
  },
  cardHeader: { marginBottom: 14 },
  cardTitle: {
    fontSize: 14,
    fontWeight: 600,
    color: '#e0e0f0',
    marginBottom: 6,
    fontFamily: "'Syne', sans-serif",
  },
  cardMeta: { display: 'flex', gap: 14, flexWrap: 'wrap' },
  metaItem: { fontSize: 11, color: '#3a3a6a' },
  tableHeader: {
    display: 'flex',
    borderBottom: '1px solid #1a1a2e',
    paddingBottom: 6,
    marginBottom: 6,
    fontSize: 10,
    color: '#3a3a6a',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  tableRow: {
    display: 'flex',
    padding: '5px 4px',
    borderRadius: 4,
    fontSize: 13,
  },
  col1: { flex: 2, color: '#8080b0' },
  col2: { flex: 1, textAlign: 'right', color: '#3a3a6a', fontSize: 10 },
  col2mono: { flex: 1, textAlign: 'right', fontFamily: "'JetBrains Mono', monospace" },
  filterNote: {
    fontSize: 12,
    color: '#4a4a6a',
    background: '#0a0a18',
    border: '1px solid #1a1a2e',
    borderRadius: 6,
    padding: '10px 16px',
    marginBottom: 16,
    letterSpacing: 0.3,
  },
  details: {
    border: '1px solid #1a1a2e',
    borderRadius: 6,
    overflow: 'hidden',
  },
  detailsSummary: {
    padding: '12px 16px',
    fontSize: 12,
    color: '#4a4a6a',
    cursor: 'pointer',
    background: '#0a0a18',
    listStyle: 'none',
  },
  rawList: {
    padding: '8px 0',
    background: '#080810',
    maxHeight: 300,
    overflowY: 'auto',
  },
  rawItem: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '6px 16px',
    fontSize: 12,
    borderBottom: '1px solid #0f0f1e',
  },
};

// CSS globale per spinner e reset
const globalCSS = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #06060e; }
  @keyframes spin { to { transform: rotate(360deg); } }
  ::-webkit-scrollbar { width: 6px; }
  ::-webkit-scrollbar-track { background: #06060e; }
  ::-webkit-scrollbar-thumb { background: #1a1a2e; border-radius: 3px; }
  details summary::-webkit-details-marker { display: none; }
`;

// Inietta CSS globale
if (typeof document !== 'undefined') {
  const style = document.createElement('style');
  style.textContent = globalCSS;
  document.head.appendChild(style);
}
