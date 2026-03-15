import { useState, useEffect, useCallback } from 'react';

// ─── COSTANTI ────────────────────────────────────────────────────────────────

const SPORT_LABELS = {
  basketball_nba: '🏀 NBA',
  basketball_euroleague: '🏀 EuroLeague',
  americanfootball_nfl: '🏈 NFL',
  baseball_mlb: '⚾ MLB',
  icehockey_nhl: '🏒 NHL',
  mma_mixed_martial_arts: '🥊 MMA',
  soccer_uefa_champs_league: '⚽ Champions League',
  soccer_uefa_europa_league: '⚽ Europa League',
  soccer_uefa_conference_league: '⚽ Conference League',
  soccer_italy_coppa_italia: '⚽ Coppa Italia',
  soccer_spain_copa_del_rey: '⚽ Copa del Rey',
  soccer_germany_dfb_pokal: '⚽ DFB Pokal',
  soccer_england_league_cup: '⚽ Carabao Cup',
  soccer_france_coupe_de_france: '⚽ Coupe de France',
  soccer_fifa_world_cup: '⚽ Mondiali',
  soccer_uefa_european_championship: '⚽ Europei',
  politics_us: '🗳 Politica USA',
};

function getSportLabel(sportKey = '') {
  if (SPORT_LABELS[sportKey]) return SPORT_LABELS[sportKey];
  if (sportKey.includes('tennis')) return '🎾 Tennis';
  if (sportKey.includes('soccer')) return '⚽ Calcio';
  if (sportKey.includes('politics')) return '🗳 Politica';
  if (sportKey.includes('crypto')) return '₿ Crypto';
  return '📊 ' + sportKey.replace(/_/g, ' ');
}

// ─── MATCHING ────────────────────────────────────────────────────────────────

const STRIP_WORDS = /\b(fc|calcio|afc|cf|sc|ac|ss|us|as|fk|bk|sk|cd|rcd|rc|sd|ud|ca|sv|vfb|vfl|rb|rbl|tsv|tsg|1899|1913|1905|1904|de|del|la|le|los|las|el|il|lo|gli|will|win|beat|vs|v|the|to|who|which|advance|qualify|make|reach|league|cup|serie|premier|champions|bundesliga|ligue|eredivisie|primeira|superliga|united|city|real|club|sporting|atletico|athletico|athletic|borussia|internazionale|inter|dynamo|dinamo|lokomotiv|spartak|shakhtar)\b/gi;

function normalize(name = '') {
  return name.toLowerCase().replace(STRIP_WORDS, ' ').replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function tokens(str) {
  return normalize(str).split(' ').filter(t => t.length >= 3);
}

function tokenOverlap(a, b) {
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.length) return 0;
  return ta.filter(t => tb.some(bt => bt.includes(t) || t.includes(bt))).length / ta.length;
}

function tryMatch(oddsEvent, polyEvent) {
  const polyText = [polyEvent.title, ...Object.keys(polyEvent.outcomes)].join(' ');
  return tokenOverlap(oddsEvent.homeTeam, polyText) >= 0.5
    || tokenOverlap(oddsEvent.awayTeam, polyText) >= 0.5;
}

function findPolyOutcome(polyOutcomes, oddsKey) {
  let best = null, bestScore = 0;
  for (const [k, v] of Object.entries(polyOutcomes)) {
    const score = Math.max(tokenOverlap(oddsKey, k), tokenOverlap(k, oddsKey));
    if (score > bestScore) { bestScore = score; best = [k, v]; }
  }
  return bestScore >= 0.35 && best ? { key: best[0], price: best[1] } : null;
}

// ─── CALCOLO ─────────────────────────────────────────────────────────────────

function devigOdds(oddsMap) {
  const entries = Object.entries(oddsMap);
  const probs = entries.map(([k, v]) => [k, 1 / v]);
  const total = probs.reduce((s, [, p]) => s + p, 0);
  return Object.fromEntries(probs.map(([k, p]) => [k, p / total]));
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function formatVolume(v) {
  if (!v || v === 0) return '';
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  return `$${v}`;
}

// ─── CSS GLOBALE ─────────────────────────────────────────────────────────────

const css = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #06060e; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }
  ::-webkit-scrollbar { width: 5px; }
  ::-webkit-scrollbar-track { background: #06060e; }
  ::-webkit-scrollbar-thumb { background: #1a1a2e; border-radius: 3px; }
  details summary::-webkit-details-marker { display: none; }
  .card:hover { border-color: rgba(0,255,136,0.2) !important; }
  .tab:hover { color: #a0a0d0 !important; }
  .btn:hover { background: rgba(0,255,136,0.1) !important; color: #00ff88 !important; }
`;
if (typeof document !== 'undefined') {
  const s = document.createElement('style');
  s.textContent = css;
  document.head.appendChild(s);
}

// ─── APP ─────────────────────────────────────────────────────────────────────

export default function App() {
  const [oddsData, setOddsData]           = useState([]);
  const [polyData, setPolyData]           = useState([]);
  const [polySeasonData, setPolySeasonData] = useState([]);
  const [loading, setLoading]             = useState(false);
  const [error, setError]                 = useState(null);
  const [lastUpdate, setLastUpdate]       = useState(null);
  const [edgeThreshold, setEdgeThreshold] = useState(3);
  const [sortBy, setSortBy]               = useState('edge'); // 'edge' | 'volume' | 'time'
  const [copyStatus, setCopyStatus]       = useState('');
  const [filterSport, setFilterSport]     = useState('all');

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [oddsRes, polyRes] = await Promise.all([
        fetch('/api/odds'),
        fetch('/api/polymarket'),
      ]);
      const [odds, poly] = await Promise.all([oddsRes.json(), polyRes.json()]);
      if (odds.error) throw new Error(`Odds API: ${odds.error}`);
      if (poly.error) throw new Error(`Polymarket: ${poly.error}`);
      setOddsData(Array.isArray(odds) ? odds : []);
      setPolyData(poly.matchMarkets || []);
      setPolySeasonData(poly.seasonMarkets || []);
      setLastUpdate(new Date());
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const iv = setInterval(fetchData, 5 * 60 * 1000);
    return () => clearInterval(iv);
  }, [fetchData]);

  // ─── MATCHING ──────────────────────────────────────────────────────────────

  const matched = [];
  for (const poly of polyData) {
    const odds = oddsData.find(e => tryMatch(e, poly));
    if (!odds) continue;

    const realProbs = devigOdds(odds.outcomes);
    const comparisons = [];

    for (const [key, realProb] of Object.entries(realProbs)) {
      const pm = findPolyOutcome(poly.outcomes, key);
      if (!pm) continue;
      const edge = parseFloat(((pm.price - realProb) * 100).toFixed(1));
      comparisons.push({ label: key, realProb: (realProb * 100).toFixed(1), polyPrice: (pm.price * 100).toFixed(1), edge });
    }

    if (!comparisons.length) continue;

    const maxEdge = Math.max(...comparisons.map(c => c.edge));
    matched.push({
      id: poly.id,
      title: poly.title,
      homeTeam: odds.homeTeam,
      awayTeam: odds.awayTeam,
      sport: odds.sport,
      commenceTime: odds.commenceTime,
      volume: poly.volume,
      comparisons,
      maxEdge,
    });
  }

  // Ordina
  const sorted = [...matched].sort((a, b) => {
    if (sortBy === 'edge') return b.maxEdge - a.maxEdge;
    if (sortBy === 'volume') return b.volume - a.volume;
    return new Date(a.commenceTime) - new Date(b.commenceTime);
  });

  // Sport unici per filtro
  const availableSports = [...new Set(matched.map(e => e.sport))];

  const filtered = filterSport === 'all'
    ? sorted
    : sorted.filter(e => e.sport === filterSport);

  const withEdge = filtered.filter(e => e.maxEdge >= edgeThreshold).length;

  // ─── COPY DEBUG ────────────────────────────────────────────────────────────

  function copyDebug() {
    const lines = [
      '=== EDGE FINDER DEBUG ===',
      `Aggiornato: ${lastUpdate?.toLocaleString('it-IT')}`,
      '',
      `POLYMARKET (${polyData.length} eventi binari abbinabili + ${polySeasonData.length} stagionali)`,
      ...polyData.map(e => `  [PM] ${e.title} | Vol: ${formatVolume(e.volume)} | ${Object.entries(e.outcomes).map(([k,v]) => `${k}: ${(v*100).toFixed(0)}%`).join(' / ')}`),
      '',
      `BOOKMAKER (${oddsData.length} eventi binari)`,
      ...oddsData.map(e => `  [BK] ${e.homeTeam} vs ${e.awayTeam} | ${getSportLabel(e.sport)} | ${Object.entries(e.outcomes).map(([k,v]) => `${k}: ${(1/v*100).toFixed(0)}%`).join(' / ')}`),
      '',
      `EVENTI ABBINATI (${matched.length}) — Edge ≥ ${edgeThreshold}%: ${withEdge}`,
      ...matched.map(e => `  ✓ ${e.title} | Edge max: ${e.maxEdge > 0 ? '+' : ''}${e.maxEdge}% | ${comparisonsLine(e.comparisons)}`),
    ];
    navigator.clipboard.writeText(lines.join('\n'));
    setCopyStatus('Copiato!');
    setTimeout(() => setCopyStatus(''), 2000);
  }

  function comparisonsLine(comps) {
    return comps.map(c => `${c.label}: reale ${c.realProb}% / PM ${c.polyPrice}% / edge ${c.edge > 0 ? '+' : ''}${c.edge}%`).join(' | ');
  }

  // ─── RENDER ────────────────────────────────────────────────────────────────

  return (
    <div style={{ minHeight: '100vh', background: '#06060e', color: '#d0d0e8', fontFamily: "'JetBrains Mono', monospace" }}>

      {/* Header */}
      <header style={{ borderBottom: '1px solid #1a1a2e', padding: '18px 24px', background: '#080810', position: 'sticky', top: 0, zIndex: 10 }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 22, fontWeight: 800, letterSpacing: 4, color: '#fff' }}>
              EDGE<span style={{ color: '#00ff88' }}>FINDER</span>
            </div>
            <div style={{ fontSize: 10, color: '#3a3a6a', marginTop: 2, letterSpacing: 1 }}>
              ARBITRAGGIO BOOKMAKER ↔ POLYMARKET — MERCATI BINARI
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {loading && <div style={{ width: 14, height: 14, border: '2px solid #1a1a2e', borderTop: '2px solid #00ff88', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />}
            {lastUpdate && <span style={{ fontSize: 11, color: '#3a3a6a' }}>{lastUpdate.toLocaleTimeString('it-IT')}</span>}
            <button className="btn" onClick={fetchData} disabled={loading}
              style={{ background: 'transparent', border: '1px solid #2a2a4a', color: '#6060a0', padding: '6px 14px', borderRadius: 4, cursor: 'pointer', fontFamily: 'inherit', fontSize: 11, transition: 'all .2s' }}>
              ⟳ Aggiorna
            </button>
          </div>
        </div>
      </header>

      <main style={{ maxWidth: 1200, margin: '0 auto', padding: '24px 16px' }}>

        {/* Errore */}
        {error && (
          <div style={{ background: 'rgba(255,80,80,.08)', border: '1px solid rgba(255,80,80,.3)', borderRadius: 6, padding: '12px 18px', color: '#ff8888', fontSize: 12, marginBottom: 20 }}>
            ⚠ {error}
            {error.includes('ODDS_API_KEY') && <div style={{ marginTop: 6, opacity: .7 }}>Registrati su the-odds-api.com e aggiungi ODDS_API_KEY nelle variabili Vercel.</div>}
          </div>
        )}

        {/* Controlli */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center', background: '#0a0a18', border: '1px solid #1a1a2e', borderRadius: 8, padding: '14px 20px', marginBottom: 20 }}>

          {/* Stats */}
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            {[
              { num: filtered.length, label: 'eventi abbinati', color: '#d0d0e8' },
              { num: withEdge, label: `edge ≥ ${edgeThreshold}%`, color: '#00ff88' },
              { num: polyData.length, label: 'Polymarket binari', color: '#6688ff' },
              { num: oddsData.length, label: 'Bookmaker binari', color: '#aa88ff' },
            ].map(s => (
              <div key={s.label} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                <span style={{ fontSize: 22, fontWeight: 600, color: s.color, lineHeight: 1 }}>{s.num}</span>
                <span style={{ fontSize: 10, color: '#3a3a6a', letterSpacing: .5 }}>{s.label}</span>
              </div>
            ))}
          </div>

          <div style={{ flex: 1 }} />

          {/* Soglia */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 10, color: '#3a3a6a', letterSpacing: 1 }}>SOGLIA EDGE</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <input type="range" min="0" max="20" step=".5" value={edgeThreshold}
                onChange={e => setEdgeThreshold(parseFloat(e.target.value))}
                style={{ accentColor: '#00ff88', width: 120, cursor: 'pointer' }} />
              <span style={{ fontSize: 14, color: '#00ff88', fontWeight: 600, minWidth: 40 }}>{edgeThreshold}%</span>
            </div>
          </div>

          {/* Ordina */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 10, color: '#3a3a6a', letterSpacing: 1 }}>ORDINA PER</span>
            <div style={{ display: 'flex', gap: 6 }}>
              {[['edge', 'Edge'], ['volume', 'Volume'], ['time', 'Data']].map(([val, lbl]) => (
                <button key={val} className="tab" onClick={() => setSortBy(val)}
                  style={{ background: sortBy === val ? 'rgba(0,255,136,.1)' : 'transparent', border: `1px solid ${sortBy === val ? '#00ff88' : '#1a1a2e'}`, color: sortBy === val ? '#00ff88' : '#4a4a6a', padding: '4px 10px', borderRadius: 4, cursor: 'pointer', fontFamily: 'inherit', fontSize: 11, transition: 'all .15s' }}>
                  {lbl}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Filtro sport */}
        {availableSports.length > 1 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 20 }}>
            <button className="tab" onClick={() => setFilterSport('all')}
              style={{ background: filterSport === 'all' ? 'rgba(0,255,136,.1)' : 'transparent', border: `1px solid ${filterSport === 'all' ? '#00ff88' : '#1a1a2e'}`, color: filterSport === 'all' ? '#00ff88' : '#4a4a6a', padding: '5px 12px', borderRadius: 4, cursor: 'pointer', fontFamily: 'inherit', fontSize: 11, transition: 'all .15s' }}>
              Tutti
            </button>
            {availableSports.map(sp => (
              <button key={sp} className="tab" onClick={() => setFilterSport(sp)}
                style={{ background: filterSport === sp ? 'rgba(0,255,136,.1)' : 'transparent', border: `1px solid ${filterSport === sp ? '#00ff88' : '#1a1a2e'}`, color: filterSport === sp ? '#00ff88' : '#4a4a6a', padding: '5px 12px', borderRadius: 4, cursor: 'pointer', fontFamily: 'inherit', fontSize: 11, transition: 'all .15s' }}>
                {getSportLabel(sp)}
              </button>
            ))}
          </div>
        )}

        {/* Loading */}
        {loading && !matched.length && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, color: '#3a3a6a', fontSize: 13, padding: '48px 0', justifyContent: 'center' }}>
            <div style={{ width: 18, height: 18, border: '2px solid #1a1a2e', borderTop: '2px solid #00ff88', borderRadius: '50%', animation: 'spin .8s linear infinite' }} />
            Recupero dati da Bookmaker e Polymarket…
          </div>
        )}

        {/* Nessun match */}
        {!loading && !error && !filtered.length && (polyData.length > 0 || oddsData.length > 0) && (
          <div style={{ textAlign: 'center', color: '#3a3a6a', fontSize: 13, padding: '48px 20px', lineHeight: 1.8 }}>
            Nessun evento abbinato trovato.<br />
            <small>Controlla il pannello Debug per vedere i dati raw delle due API.</small>
          </div>
        )}

        {/* Event Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(460px, 1fr))', gap: 12, marginBottom: 32 }}>
          {filtered.map(ev => (
            <EventCard key={ev.id} event={ev} threshold={edgeThreshold} />
          ))}
        </div>

        {/* DEBUG PANEL */}
        <details style={{ border: '1px solid #1a1a2e', borderRadius: 8, overflow: 'hidden' }}>
          <summary style={{ padding: '12px 18px', fontSize: 12, color: '#3a3a6a', cursor: 'pointer', background: '#0a0a18', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>🔍 Debug — Dati raw API ({polyData.length} PM + {oddsData.length} BK)</span>
            <button className="btn" onClick={e => { e.preventDefault(); copyDebug(); }}
              style={{ background: copyStatus ? 'rgba(0,255,136,.15)' : 'transparent', border: `1px solid ${copyStatus ? '#00ff88' : '#2a2a4a'}`, color: copyStatus ? '#00ff88' : '#6060a0', padding: '4px 12px', borderRadius: 4, cursor: 'pointer', fontFamily: 'inherit', fontSize: 11, transition: 'all .2s' }}>
              {copyStatus || '📋 Copia tutto'}
            </button>
          </summary>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
            {/* Polymarket */}
            <div>
              <div style={{ padding: '8px 16px', fontSize: 10, color: '#00ff88', letterSpacing: 1, borderBottom: '1px solid #1a1a2e', background: '#080810' }}>
                POLYMARKET BINARI ({polyData.length})
              </div>
              <div style={{ maxHeight: 280, overflowY: 'auto', background: '#080810' }}>
                {polyData.map(e => (
                  <div key={e.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 14px', borderBottom: '1px solid #0d0d1e', gap: 8 }}>
                    <span style={{ color: '#8080b0', fontSize: 11, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.title}</span>
                    <span style={{ color: '#3a3a6a', fontSize: 10, flexShrink: 0 }}>{formatVolume(e.volume)}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Bookmaker */}
            <div style={{ borderLeft: '1px solid #1a1a2e' }}>
              <div style={{ padding: '8px 16px', fontSize: 10, color: '#6688ff', letterSpacing: 1, borderBottom: '1px solid #1a1a2e', background: '#080810' }}>
                BOOKMAKER BINARI ({oddsData.length})
              </div>
              <div style={{ maxHeight: 280, overflowY: 'auto', background: '#080810' }}>
                {oddsData.map(e => (
                  <div key={e.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 14px', borderBottom: '1px solid #0d0d1e', gap: 8 }}>
                    <span style={{ color: '#8080b0', fontSize: 11, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {e.homeTeam} vs {e.awayTeam}
                    </span>
                    <span style={{ color: '#3a3a6a', fontSize: 10, flexShrink: 0 }}>{getSportLabel(e.sport)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </details>

      </main>
    </div>
  );
}

// ─── EVENT CARD ──────────────────────────────────────────────────────────────

function EventCard({ event, threshold }) {
  const hasEdge = event.maxEdge >= threshold;

  return (
    <div className="card" style={{
      background: '#0a0a18',
      border: `1px solid ${hasEdge ? 'rgba(0,255,136,.35)' : '#1a1a2e'}`,
      borderRadius: 8,
      padding: '14px 16px',
      position: 'relative',
      transition: 'border-color .2s',
    }}>
      {hasEdge && (
        <div style={{ position: 'absolute', top: -1, right: 14, background: '#00ff88', color: '#000', fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: '0 0 6px 6px', letterSpacing: 1 }}>
          EDGE +{event.maxEdge}%
        </div>
      )}

      {/* Titolo */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#e0e0f0', fontFamily: "'Syne', sans-serif", marginBottom: 4, paddingRight: hasEdge ? 60 : 0 }}>
          {event.homeTeam} vs {event.awayTeam}
        </div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 10, color: '#3a3a6a' }}>{getSportLabel(event.sport)}</span>
          {event.commenceTime && <span style={{ fontSize: 10, color: '#3a3a6a' }}>🕐 {formatDate(event.commenceTime)}</span>}
          {event.volume > 0 && <span style={{ fontSize: 10, color: '#3a3a6a' }}>💧 {formatVolume(event.volume)}</span>}
        </div>
      </div>

      {/* Tabella comparazione */}
      <div style={{ display: 'flex', fontSize: 9, color: '#2a2a5a', letterSpacing: 1, textTransform: 'uppercase', borderBottom: '1px solid #1a1a2e', paddingBottom: 5, marginBottom: 5 }}>
        <span style={{ flex: 2 }}>Esito</span>
        <span style={{ flex: 1, textAlign: 'right' }}>Prob. reale</span>
        <span style={{ flex: 1, textAlign: 'right' }}>Polymarket</span>
        <span style={{ flex: 1, textAlign: 'right' }}>Edge</span>
      </div>

      {event.comparisons.map((c, i) => {
        const edgeColor = c.edge >= threshold ? '#00ff88' : c.edge >= 0 ? '#668866' : '#884444';
        return (
          <div key={i} style={{ display: 'flex', padding: '4px 0', background: c.edge >= threshold ? 'rgba(0,255,136,.04)' : 'transparent', borderRadius: 3 }}>
            <span style={{ flex: 2, fontSize: 12, color: '#8080b0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.label}</span>
            <span style={{ flex: 1, textAlign: 'right', fontSize: 12 }}>{c.realProb}%</span>
            <span style={{ flex: 1, textAlign: 'right', fontSize: 12 }}>{c.polyPrice}%</span>
            <span style={{ flex: 1, textAlign: 'right', fontSize: 12, color: edgeColor, fontWeight: 600 }}>
              {c.edge > 0 ? '+' : ''}{c.edge}%
            </span>
          </div>
        );
      })}
    </div>
  );
}
