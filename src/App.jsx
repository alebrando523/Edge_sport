import { useState, useEffect, useCallback, useMemo } from 'react';

// ─── CSS ─────────────────────────────────────────────────────────────────────
const css = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #06060e; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes glow { 0%,100%{box-shadow:0 0 8px rgba(0,255,136,.3)} 50%{box-shadow:0 0 24px rgba(0,255,136,.7)} }
  ::-webkit-scrollbar { width: 5px; }
  ::-webkit-scrollbar-track { background: #06060e; }
  ::-webkit-scrollbar-thumb { background: #1a1a2e; border-radius: 3px; }
  details summary::-webkit-details-marker { display: none; }
  .card-arb { animation: glow 2s ease-in-out infinite; }
  .btn:hover { background: rgba(0,255,136,.1) !important; color: #00ff88 !important; border-color: #00ff88 !important; }
  .tab-btn:hover { color: #a0a0d0 !important; }
`;
if (typeof document !== 'undefined') {
  const existing = document.getElementById('ef-styles');
  if (!existing) {
    const s = document.createElement('style');
    s.id = 'ef-styles';
    s.textContent = css;
    document.head.appendChild(s);
  }
}

// ─── SPORT LABELS ────────────────────────────────────────────────────────────
const SPORT_LABELS = {
  basketball_nba: '🏀 NBA',
  basketball_euroleague: '🏀 EuroLeague',
  americanfootball_nfl: '🏈 NFL',
  baseball_mlb: '⚾ MLB',
  icehockey_nhl: '🏒 NHL',
  mma_mixed_martial_arts: '🥊 MMA',
  soccer_uefa_champs_league: '⚽ UCL',
  soccer_uefa_europa_league: '⚽ UEL',
  soccer_uefa_conference_league: '⚽ UECL',
  soccer_italy_coppa_italia: '⚽ Coppa Italia',
  soccer_spain_copa_del_rey: '⚽ Copa del Rey',
  soccer_germany_dfb_pokal: '⚽ DFB Pokal',
  soccer_england_league_cup: '⚽ Carabao Cup',
  soccer_france_coupe_de_france: '⚽ Coupe de France',
  soccer_fifa_world_cup: '⚽ Mondiali',
  soccer_uefa_european_championship: '⚽ Europei',
};
function getSportLabel(key = '') {
  if (SPORT_LABELS[key]) return SPORT_LABELS[key];
  if (key.includes('tennis')) return '🎾 Tennis';
  if (key.includes('soccer')) return '⚽ Calcio';
  if (key.includes('politics')) return '🗳 Politica';
  return '📊 ' + key.replace(/_/g, ' ');
}

// ─── UTILS ───────────────────────────────────────────────────────────────────
function formatDate(d) {
  if (!d) return '';
  return new Date(d).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}
function formatVol(v) {
  if (!v) return '';
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${Math.round(v)}`;
}

// ─── MATCHING ────────────────────────────────────────────────────────────────
const STRIP = /\b(fc|calcio|afc|cf|sc|ac|ss|us|as|fk|bk|sk|cd|rcd|rc|sd|ud|ca|sv|vfb|vfl|rb|rbl|tsv|tsg|1899|1913|1905|1904|de|del|la|le|los|las|el|il|lo|gli|will|win|beat|vs|v|the|to|who|which|advance|qualify|make|reach|league|cup|serie|premier|champions|bundesliga|ligue|united|city|real|club|sporting|atletico|athletico|borussia|internazionale|inter|dynamo|dinamo)\b/gi;

function normalize(s = '') {
  return s.toLowerCase().replace(STRIP, ' ').replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
}
function tokens(s) { return normalize(s).split(' ').filter(t => t.length >= 3); }
function overlap(a, b) {
  const ta = tokens(a), tb = tokens(b);
  if (!ta.length) return 0;
  return ta.filter(t => tb.some(bt => bt.includes(t) || t.includes(bt))).length / ta.length;
}

// Controlla compatibilità data entro tolleranza in ore
function datesCompatible(dateA, dateB, toleranceHours = 24) {
  if (!dateA || !dateB) return true;
  const diff = Math.abs(new Date(dateA) - new Date(dateB));
  return diff / 3600000 <= toleranceHours;
}

function isMatch(oddsEv, polyEv) {
  // 1. Compatibilità data/ora — tolleranza 24h
  if (!datesCompatible(oddsEv.commenceTime, polyEv.startDate, 24)) return false;
  // 2. Overlap nomi squadre sul titolo e outcomes Polymarket
  const polyText = [polyEv.title, ...Object.keys(polyEv.outcomes)].join(' ');
  return overlap(oddsEv.homeTeam, polyText) >= 0.5 || overlap(oddsEv.awayTeam, polyText) >= 0.5;
}

// ─── CALCOLO ARBITRAGGIO ─────────────────────────────────────────────────────
//
//  Strategia: per ogni evento abbinato proviamo tutte le combinazioni
//  (lato BK) vs (lato opposto PM). L'arbitraggio esiste quando:
//
//    (1 / quotaBK) + (1 / quotaPM)  <  1.0
//
//  Profitto % = (1/margin - 1) * 100
//  Stake BK   = budget / (quotaBK * margin)
//  Stake PM   = budget / (quotaPM * margin)

function calcArbitrage(oddsEv, polyEv, budget = 100) {
  const oddsOut = Object.entries(oddsEv.outcomes);   // [[team, quota]]
  const polyOut = Object.entries(polyEv.outcomes);   // [[team, price 0-1]]

  if (oddsOut.length !== 2 || polyOut.length !== 2) return null;

  const candidates = [];

  for (const [bkTeam, bkQuota] of oddsOut) {
    // Quota bookmaker irrealistica → scarta
    if (bkQuota > 10.0 || bkQuota < 1.01) continue;

    for (const [pmTeam, pmPrice] of polyOut) {
      // Prezzo Polymarket anomalo → scarta
      if (pmPrice >= 0.99 || pmPrice <= 0.01) continue;

      // BK e PM devono riguardare squadre DIVERSE (lati opposti)
      if (overlap(bkTeam, pmTeam) >= 0.4) continue;

      // Verifica che il lato rimanente BK corrisponda al lato PM scommesso
      const [bkTeam2, bkQuota2] = oddsOut.find(([t]) => t !== bkTeam);
      const pmRemainder = polyOut.find(([t]) => t !== pmTeam);
      if (!pmRemainder) continue;
      const [pmTeam2, pmPrice2] = pmRemainder;

      // Il lato rimanente PM deve anche essere valido
      if (pmPrice2 >= 0.99 || pmPrice2 <= 0.01) continue;

      // Cross-check: bkTeam deve corrispondere a pmTeam2 (stessa squadra, lati opposti)
      // E bkTeam2 deve corrispondere a pmTeam
      const crossA = overlap(bkTeam, pmTeam2);
      const crossB = overlap(bkTeam2, pmTeam);
      if (crossA < 0.35 && crossB < 0.35) continue;

      const pmQuota = 1 / pmPrice;
      const margin = (1 / bkQuota) + (1 / pmQuota);

      // Margine irrealistico → scarta (match errato)
      if (margin < 0.6 || margin > 1.4) continue;

      candidates.push({
        margin,
        bkSide: { team: bkTeam, quota: bkQuota },
        pmSide: { team: pmTeam, price: pmPrice, quota: pmQuota },
      });
    }
  }

  if (!candidates.length) return null;

  candidates.sort((a, b) => a.margin - b.margin);
  const best = candidates[0];
  const profit = (1 / best.margin - 1) * 100;

  return {
    isArbitrage: best.margin < 1.0,
    margin: best.margin,
    profit: profit.toFixed(2),
    stakeBK: (budget / (best.bkSide.quota * best.margin)).toFixed(2),
    stakePM: (budget / (best.pmSide.quota * best.margin)).toFixed(2),
    bkSide: best.bkSide,
    pmSide: best.pmSide,
  };
}

// ─── COMPONENTE PRINCIPALE ───────────────────────────────────────────────────
export default function App() {
  const [oddsData, setOddsData]       = useState([]);
  const [polyData, setPolyData]       = useState([]);
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState(null);
  const [lastUpdate, setLastUpdate]   = useState(null);
  const [apiUsage, setApiUsage]       = useState(null);
  const [budget, setBudget]           = useState(100);
  const [showAll, setShowAll]         = useState(false);
  const [copyStatus, setCopyStatus]   = useState('');
  const [filterSport, setFilterSport] = useState('all');

  // ─── FETCH ─────────────────────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [oRes, pRes] = await Promise.all([
        fetch('/api/odds'),
        fetch('/api/polymarket'),
      ]);
      if (!oRes.ok) throw new Error(`Odds API HTTP ${oRes.status}`);
      if (!pRes.ok) throw new Error(`Polymarket HTTP ${pRes.status}`);

      const [odds, poly] = await Promise.all([oRes.json(), pRes.json()]);

      if (odds.error) throw new Error(`Odds API: ${odds.error}`);
      if (poly.error) throw new Error(`Polymarket: ${poly.error}`);

      setOddsData(odds.events || (Array.isArray(odds) ? odds : []));
      setPolyData(poly.matchMarkets || []);
      if (odds.apiUsage) setApiUsage(odds.apiUsage);
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

  // ─── CALCOLO — useMemo: ricalcola solo quando cambiano i dati o il budget ──
  const results = useMemo(() => {
    const out = [];
    for (const poly of polyData) {
      const odds = oddsData.find(e => isMatch(e, poly));
      if (!odds) continue;
      const arb = calcArbitrage(odds, poly, budget);
      if (!arb) continue;
      out.push({
        id: poly.id,
        title: poly.title,
        homeTeam: odds.homeTeam,
        awayTeam: odds.awayTeam,
        sport: odds.sport,
        commenceTime: odds.commenceTime,
        volume: poly.volume,
        arb,
      });
    }
    return out.sort((a, b) => parseFloat(b.arb.profit) - parseFloat(a.arb.profit));
  }, [oddsData, polyData, budget]);

  const arbOpps  = useMemo(() => results.filter(r => r.arb.isArbitrage), [results]);
  // Near-miss: margin tra 1.00 e 1.05 (gap max 5%)
  const nearMiss = useMemo(() =>
    results.filter(r => !r.arb.isArbitrage && r.arb.margin <= 1.05),
  [results]);

  const displayed = showAll
    ? results
    : arbOpps.length ? arbOpps : nearMiss;

  const sports = useMemo(() => [...new Set(results.map(r => r.sport))], [results]);

  const filtered = filterSport === 'all'
    ? displayed
    : displayed.filter(r => r.sport === filterSport);

  // Reset filtro sport se lo sport selezionato non è più disponibile
  useEffect(() => {
    if (filterSport !== 'all' && !sports.includes(filterSport)) {
      setFilterSport('all');
    }
  }, [sports, filterSport]);

  // ─── COPY DEBUG ────────────────────────────────────────────────────────────
  function copyDebug() {
    const lines = [
      '=== EDGE FINDER — ARBITRAGGIO ===',
      `Aggiornato: ${lastUpdate?.toLocaleString('it-IT')}`,
      `Budget simulazione: €${budget}`,
      '',
      `ARB REALI (${arbOpps.length})`,
      ...arbOpps.map(r =>
        `✓ ${r.homeTeam} vs ${r.awayTeam} | +${r.arb.profit}% | ` +
        `BK: ${r.arb.bkSide.team} €${r.arb.stakeBK} @ ${r.arb.bkSide.quota.toFixed(3)} | ` +
        `PM: ${r.arb.pmSide.team} €${r.arb.stakePM} @ ${(r.arb.pmSide.price * 100).toFixed(1)}¢`
      ),
      '',
      `NEAR-MISS (margine ≤ 105%) — (${nearMiss.length})`,
      ...nearMiss.map(r =>
        `~ ${r.homeTeam} vs ${r.awayTeam} | margine ${(r.arb.margin * 100).toFixed(2)}%`
      ),
      '',
      `POLYMARKET (${polyData.length})`,
      ...polyData.map(e =>
        `  ${e.title} | ${formatVol(e.volume)} | ${Object.entries(e.outcomes).map(([k, v]) => `${k}:${(v * 100).toFixed(0)}¢`).join(' / ')}`
      ),
      '',
      `BOOKMAKER (${oddsData.length})`,
      ...oddsData.map(e =>
        `  ${e.homeTeam} vs ${e.awayTeam} | ${getSportLabel(e.sport)} | ${Object.entries(e.outcomes).map(([k, v]) => `${k}:${v}`).join(' / ')}`
      ),
    ];
    navigator.clipboard.writeText(lines.join('\n'))
      .then(() => { setCopyStatus('✓ Copiato!'); setTimeout(() => setCopyStatus(''), 2500); })
      .catch(() => { setCopyStatus('Errore'); setTimeout(() => setCopyStatus(''), 2500); });
  }

  // ─── RENDER ────────────────────────────────────────────────────────────────
  const btnStyle = (active) => ({
    background: active ? 'rgba(0,255,136,.1)' : 'transparent',
    border: `1px solid ${active ? '#00ff88' : '#1a1a2e'}`,
    color: active ? '#00ff88' : '#4a4a6a',
    padding: '5px 12px',
    borderRadius: 4,
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontSize: 11,
    transition: 'all .15s',
  });

  return (
    <div style={{ minHeight: '100vh', background: '#06060e', color: '#d0d0e8', fontFamily: "'JetBrains Mono', monospace" }}>

      {/* ── HEADER ── */}
      <header style={{ borderBottom: '1px solid #1a1a2e', padding: '16px 24px', background: '#080810', position: 'sticky', top: 0, zIndex: 10 }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 22, fontWeight: 800, letterSpacing: 4, color: '#fff' }}>
              EDGE<span style={{ color: '#00ff88' }}>FINDER</span>
              <span style={{ fontSize: 10, color: '#2a2a5a', marginLeft: 10, letterSpacing: 2 }}>ARBITRAGGIO PURO</span>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            {loading && <div style={{ width: 14, height: 14, border: '2px solid #1a1a2e', borderTop: '2px solid #00ff88', borderRadius: '50%', animation: 'spin .8s linear infinite' }} />}
            {lastUpdate && <span style={{ fontSize: 11, color: '#3a3a6a' }}>{lastUpdate.toLocaleTimeString('it-IT')}</span>}
            {apiUsage && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#0a0a18', border: '1px solid #1a1a2e', borderRadius: 4, padding: '4px 10px' }}>
                <span style={{ fontSize: 10, color: '#3a3a6a', letterSpacing: 1 }}>API</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: apiUsage.remaining < 50 ? '#ff5555' : apiUsage.remaining < 150 ? '#ffaa44' : '#00ff88' }}>
                  {apiUsage.used}/{apiUsage.used + apiUsage.remaining}
                </span>
                <span style={{ fontSize: 10, color: '#2a2a4a' }}>({apiUsage.remaining} rimaste)</span>
              </div>
            )}
            <button className="btn" onClick={fetchData} disabled={loading}
              style={{ background: 'transparent', border: '1px solid #2a2a4a', color: '#6060a0', padding: '6px 14px', borderRadius: 4, cursor: 'pointer', fontFamily: 'inherit', fontSize: 11, transition: 'all .2s' }}>
              ⟳ Aggiorna
            </button>
          </div>
        </div>
      </header>

      <main style={{ maxWidth: 1200, margin: '0 auto', padding: '24px 16px' }}>

        {/* ── ERRORE ── */}
        {error && (
          <div style={{ background: 'rgba(255,80,80,.08)', border: '1px solid rgba(255,80,80,.3)', borderRadius: 6, padding: '12px 18px', color: '#ff8888', fontSize: 12, marginBottom: 20 }}>
            ⚠ {error}
          </div>
        )}

        {/* ── CONTROLLI ── */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20, alignItems: 'center', background: '#0a0a18', border: '1px solid #1a1a2e', borderRadius: 8, padding: '16px 20px', marginBottom: 20 }}>

          {/* Stats */}
          <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap' }}>
            {[
              { num: arbOpps.length,  label: 'arb reali',      color: '#00ff88' },
              { num: nearMiss.length, label: 'near-miss ≤5%',  color: '#ffaa44' },
              { num: polyData.length, label: 'Polymarket',      color: '#6688ff' },
              { num: oddsData.length, label: 'Bookmaker',       color: '#aa88ff' },
            ].map(s => (
              <div key={s.label} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                <span style={{ fontSize: 24, fontWeight: 700, color: s.color, lineHeight: 1 }}>{s.num}</span>
                <span style={{ fontSize: 10, color: '#3a3a6a' }}>{s.label}</span>
              </div>
            ))}
          </div>

          <div style={{ flex: 1 }} />

          {/* Budget */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 10, color: '#3a3a6a', letterSpacing: 1 }}>BUDGET SIMULAZIONE (€)</span>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {[50, 100, 200, 500, 1000].map(v => (
                <button key={v} className="tab-btn" onClick={() => setBudget(v)} style={btnStyle(budget === v)}>
                  {v}
                </button>
              ))}
            </div>
          </div>

          {/* Toggle mostra tutti */}
          <button className="btn" onClick={() => setShowAll(s => !s)}
            style={{ background: showAll ? 'rgba(255,170,68,.1)' : 'transparent', border: `1px solid ${showAll ? '#ffaa44' : '#2a2a4a'}`, color: showAll ? '#ffaa44' : '#6060a0', padding: '6px 14px', borderRadius: 4, cursor: 'pointer', fontFamily: 'inherit', fontSize: 11, transition: 'all .2s' }}>
            {showAll ? '← Solo arb reali' : 'Mostra tutti →'}
          </button>
        </div>

        {/* ── FILTRO SPORT ── */}
        {sports.length > 1 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
            {['all', ...sports].map(sp => (
              <button key={sp} className="tab-btn" onClick={() => setFilterSport(sp)} style={btnStyle(filterSport === sp)}>
                {sp === 'all' ? 'Tutti' : getSportLabel(sp)}
              </button>
            ))}
          </div>
        )}

        {/* ── LEGENDA ── */}
        <div style={{ fontSize: 11, color: '#3a3a6a', marginBottom: 20, display: 'flex', gap: 20, flexWrap: 'wrap' }}>
          <span><span style={{ color: '#00ff88' }}>●</span> ARB REALE — profitto garantito qualunque sia l'esito</span>
          <span><span style={{ color: '#ffaa44' }}>●</span> NEAR-MISS — margine ≤105%, monitorare</span>
        </div>

        {/* ── LOADING ── */}
        {loading && !results.length && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, color: '#3a3a6a', fontSize: 13, padding: '48px 0', justifyContent: 'center' }}>
            <div style={{ width: 18, height: 18, border: '2px solid #1a1a2e', borderTop: '2px solid #00ff88', borderRadius: '50%', animation: 'spin .8s linear infinite' }} />
            Scansione mercati in corso…
          </div>
        )}

        {/* ── NESSUN RISULTATO ── */}
        {!loading && !error && !filtered.length && (
          <div style={{ textAlign: 'center', color: '#3a3a6a', fontSize: 13, padding: '48px 20px', lineHeight: 2 }}>
            {results.length === 0
              ? 'Nessun evento abbinato tra Bookmaker e Polymarket.'
              : 'Nessuna opportunità aperta in questo momento.'
            }<br />
            <small>Aggiornamento automatico ogni 5 minuti.</small><br />
            {!showAll && (
              <button className="btn" onClick={() => setShowAll(true)}
                style={{ marginTop: 16, background: 'transparent', border: '1px solid #2a2a4a', color: '#6060a0', padding: '8px 20px', borderRadius: 4, cursor: 'pointer', fontFamily: 'inherit', fontSize: 12 }}>
                Mostra match vicini all'arbitraggio
              </button>
            )}
          </div>
        )}

        {/* ── CARDS ── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(480px, 1fr))', gap: 14, marginBottom: 32 }}>
          {filtered.map(r => <ArbCard key={r.id} result={r} budget={budget} />)}
        </div>

        {/* ── DEBUG ── */}
        <details style={{ border: '1px solid #1a1a2e', borderRadius: 8, overflow: 'hidden' }}>
          <summary style={{ padding: '12px 18px', fontSize: 12, color: '#3a3a6a', cursor: 'pointer', background: '#0a0a18', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>🔍 Debug — {polyData.length} Polymarket + {oddsData.length} Bookmaker + {results.length} abbinati</span>
            <button className="btn" onClick={e => { e.preventDefault(); copyDebug(); }}
              style={{ background: copyStatus ? 'rgba(0,255,136,.15)' : 'transparent', border: `1px solid ${copyStatus ? '#00ff88' : '#2a2a4a'}`, color: copyStatus ? '#00ff88' : '#6060a0', padding: '4px 12px', borderRadius: 4, cursor: 'pointer', fontFamily: 'inherit', fontSize: 11, transition: 'all .2s' }}>
              {copyStatus || '📋 Copia tutto'}
            </button>
          </summary>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
            <div>
              <div style={{ padding: '7px 14px', fontSize: 10, color: '#00ff88', letterSpacing: 1, borderBottom: '1px solid #1a1a2e', background: '#080810' }}>
                POLYMARKET ({polyData.length})
              </div>
              <div style={{ maxHeight: 260, overflowY: 'auto', background: '#080810' }}>
                {polyData.map(e => (
                  <div key={e.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 14px', borderBottom: '1px solid #0d0d1e' }}>
                    <span style={{ color: '#8080b0', fontSize: 11, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.title}</span>
                    <span style={{ color: '#3a3a6a', fontSize: 10, marginLeft: 8, flexShrink: 0 }}>{formatVol(e.volume)}</span>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ borderLeft: '1px solid #1a1a2e' }}>
              <div style={{ padding: '7px 14px', fontSize: 10, color: '#6688ff', letterSpacing: 1, borderBottom: '1px solid #1a1a2e', background: '#080810' }}>
                BOOKMAKER ({oddsData.length})
              </div>
              <div style={{ maxHeight: 260, overflowY: 'auto', background: '#080810' }}>
                {oddsData.map(e => (
                  <div key={e.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 14px', borderBottom: '1px solid #0d0d1e' }}>
                    <span style={{ color: '#8080b0', fontSize: 11, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.homeTeam} vs {e.awayTeam}</span>
                    <span style={{ color: '#3a3a6a', fontSize: 10, marginLeft: 8, flexShrink: 0 }}>{getSportLabel(e.sport)}</span>
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

// ─── ARB CARD ─────────────────────────────────────────────────────────────────
function ArbCard({ result, budget }) {
  const { arb, homeTeam, awayTeam, sport, commenceTime, volume } = result;
  const isReal = arb.isArbitrage;
  const profitEuro = (budget * parseFloat(arb.profit) / 100).toFixed(2);

  return (
    <div className={isReal ? 'card-arb' : ''}
      style={{
        background: '#0a0a18',
        border: `1px solid ${isReal ? 'rgba(0,255,136,.5)' : 'rgba(255,170,68,.25)'}`,
        borderRadius: 8,
        padding: '16px 18px',
        position: 'relative',
      }}>

      {/* Badge */}
      <div style={{ position: 'absolute', top: -1, right: 14, background: isReal ? '#00ff88' : '#ffaa44', color: '#000', fontSize: 9, fontWeight: 800, padding: '2px 10px', borderRadius: '0 0 6px 6px', letterSpacing: 1.5 }}>
        {isReal ? `ARB +${arb.profit}%` : `GAP ${(arb.margin * 100 - 100).toFixed(2)}%`}
      </div>

      {/* Titolo */}
      <div style={{ marginBottom: 14, paddingRight: 90 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#f0f0ff', fontFamily: "'Syne', sans-serif", marginBottom: 5 }}>
          {homeTeam} vs {awayTeam}
        </div>
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 10, color: '#3a3a6a' }}>{getSportLabel(sport)}</span>
          {commenceTime && <span style={{ fontSize: 10, color: '#3a3a6a' }}>🕐 {formatDate(commenceTime)}</span>}
          {volume > 0 && <span style={{ fontSize: 10, color: '#3a3a6a' }}>💧 {formatVol(volume)}</span>}
        </div>
      </div>

      <div style={{ borderTop: '1px solid #1a1a2e', marginBottom: 12 }} />

      {/* Lato BK */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(102,136,255,.06)', border: '1px solid rgba(102,136,255,.15)', borderRadius: 6, padding: '10px 14px', marginBottom: 8 }}>
        <div style={{ fontSize: 11, color: '#6688ff', fontWeight: 700, minWidth: 32 }}>BK</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, color: '#c0c0e0', fontWeight: 600 }}>Vince {arb.bkSide.team}</div>
          <div style={{ fontSize: 11, color: '#3a3a6a', marginTop: 2 }}>Quota {arb.bkSide.quota.toFixed(3)}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#6688ff' }}>€{arb.stakeBK}</div>
          <div style={{ fontSize: 10, color: '#3a3a6a' }}>da investire</div>
        </div>
      </div>

      {/* Lato PM */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(0,255,136,.04)', border: '1px solid rgba(0,255,136,.15)', borderRadius: 6, padding: '10px 14px', marginBottom: 12 }}>
        <div style={{ fontSize: 11, color: '#00ff88', fontWeight: 700, minWidth: 32 }}>PM</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, color: '#c0c0e0', fontWeight: 600 }}>Vince {arb.pmSide.team}</div>
          <div style={{ fontSize: 11, color: '#3a3a6a', marginTop: 2 }}>
            Prezzo {(arb.pmSide.price * 100).toFixed(1)}¢ → quota {arb.pmSide.quota.toFixed(3)}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#00ff88' }}>€{arb.stakePM}</div>
          <div style={{ fontSize: 10, color: '#3a3a6a' }}>da investire</div>
        </div>
      </div>

      {/* Risultato */}
      <div style={{ background: isReal ? 'rgba(0,255,136,.07)' : 'rgba(255,170,68,.05)', border: `1px solid ${isReal ? 'rgba(0,255,136,.2)' : 'rgba(255,170,68,.15)'}`, borderRadius: 6, padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: 10, color: '#3a3a6a', letterSpacing: 1, marginBottom: 3 }}>
            {isReal ? '✓ PROFITTO GARANTITO' : '⏳ FINESTRA NON ANCORA APERTA'}
          </div>
          <div style={{ fontSize: 11, color: '#5a5a8a' }}>
            Totale investito: <strong style={{ color: '#8080b0' }}>€{budget}</strong>
            {' · '}Margine: <strong style={{ color: isReal ? '#00ff88' : '#ffaa44' }}>{(arb.margin * 100).toFixed(2)}%</strong>
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 24, fontWeight: 800, color: isReal ? '#00ff88' : '#ffaa44', fontFamily: "'Syne', sans-serif", lineHeight: 1 }}>
            {isReal ? `+€${profitEuro}` : `−€${Math.abs(profitEuro)}`}
          </div>
          <div style={{ fontSize: 10, color: '#3a3a6a', marginTop: 2 }}>
            {isReal ? `+${arb.profit}%` : `gap ${arb.profit}%`} su €{budget}
          </div>
        </div>
      </div>

    </div>
  );
}
