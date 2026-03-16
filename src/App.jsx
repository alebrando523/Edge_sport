import { useState, useEffect, useCallback, useMemo } from 'react';

// ─── CSS ─────────────────────────────────────────────────────────────────────
const css = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #05050d; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes glow-green { 0%,100%{box-shadow:0 0 0 rgba(0,255,136,0)} 50%{box-shadow:0 0 20px rgba(0,255,136,.4)} }
  @keyframes glow-amber { 0%,100%{box-shadow:0 0 0 rgba(255,170,68,0)} 50%{box-shadow:0 0 16px rgba(255,170,68,.3)} }
  ::-webkit-scrollbar { width: 4px; }
  ::-webkit-scrollbar-thumb { background: #1a1a2e; border-radius: 2px; }
  details > summary { list-style: none; }
  details > summary::-webkit-details-marker { display: none; }
  .arb-card { animation: glow-green 3s ease-in-out infinite; }
  .near-card { animation: glow-amber 3s ease-in-out infinite; }
  .hvr:hover { opacity: .75; cursor: pointer; }
`;
if (typeof document !== 'undefined' && !document.getElementById('sb-css')) {
  const s = document.createElement('style');
  s.id = 'sb-css'; s.textContent = css;
  document.head.appendChild(s);
}

// ─── UTILS ───────────────────────────────────────────────────────────────────
const getSport = k => {
  const m = {
    basketball_nba:'🏀 NBA', basketball_euroleague:'🏀 EuroLeague',
    americanfootball_nfl:'🏈 NFL', baseball_mlb:'⚾ MLB',
    icehockey_nhl:'🏒 NHL', mma_mixed_martial_arts:'🥊 MMA',
    soccer_epl:'⚽ Premier League', soccer_italy_serie_a:'⚽ Serie A',
    soccer_spain_la_liga:'⚽ La Liga', soccer_germany_bundesliga:'⚽ Bundesliga',
    soccer_france_ligue_one:'⚽ Ligue 1', soccer_uefa_champs_league:'⚽ Champions League',
    soccer_uefa_europa_league:'⚽ Europa League', soccer_uefa_conference_league:'⚽ Conference League',
    soccer_italy_coppa_italia:'⚽ Coppa Italia', soccer_spain_copa_del_rey:'⚽ Copa del Rey',
    soccer_germany_dfb_pokal:'⚽ DFB Pokal', soccer_england_league_cup:'⚽ Carabao Cup',
    soccer_fifa_world_cup:'⚽ Mondiali', soccer_uefa_european_championship:'⚽ Europei',
  };
  if (m[k]) return m[k];
  if (k?.includes('tennis')) return '🎾 Tennis';
  if (k?.includes('soccer')) return '⚽ Calcio';
  if (k?.includes('rugby')) return '🏉 Rugby';
  if (k?.includes('cricket')) return '🏏 Cricket';
  if (k?.includes('darts')) return '🎯 Darts';
  return '📊 ' + (k||'').replace(/_/g,' ');
};

const fmtDate = d => d ? new Date(d).toLocaleString('it-IT',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}) : '';
const fmtEur = n => `€${parseFloat(n).toFixed(2)}`;

// ─── CALCOLO STAKE BACK/LAY ───────────────────────────────────────────────────
// Dato budget totale B:
//   stakeBack = B / (1 + backOdds/layOddsAdj - 1) → formula esatta:
//   Per avere profitto uguale in entrambi i casi:
//   stakeBack × backOdds = stakeLay × layOdds
//   stakeBack + stakeLay = budget (approssimato)
//   → stakeBack = budget × layOddsAdj / (backOdds + layOddsAdj - 1)  [approssimato]
//   → stakeLay  = budget × backOdds    / (backOdds + layOddsAdj - 1)
function calcStakes(backOdds, layOddsAdj, budget) {
  const denom = backOdds + layOddsAdj - 1;
  const stakeBack = (budget * layOddsAdj) / denom;
  const stakeLay  = (budget * backOdds)    / denom;
  // Profitto se back vince = stakeBack*(backOdds-1) - stakeLay*(layOddsAdj-1)
  const profitIfWin  = stakeBack*(backOdds-1) - stakeLay*(layOddsAdj-1);
  // Profitto se back perde = stakeLay - stakeBack
  const profitIfLose = stakeLay - stakeBack;
  return {
    stakeBack: stakeBack.toFixed(2),
    stakeLay:  stakeLay.toFixed(2),
    profitIfWin:  profitIfWin.toFixed(2),
    profitIfLose: profitIfLose.toFixed(2),
    minProfit: Math.min(profitIfWin, profitIfLose).toFixed(2),
  };
}

// ─── APP ─────────────────────────────────────────────────────────────────────
export default function App() {
  const [events, setEvents]           = useState([]);
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState(null);
  const [lastUpdate, setLastUpdate]   = useState(null);
  const [apiUsage, setApiUsage]       = useState(null);
  const [budget, setBudget]           = useState(100);
  const [showNear, setShowNear]       = useState(false);
  const [nearThreshold, setNearThreshold] = useState(3);
  const [filterSport, setFilterSport] = useState('all');
  const [filterType, setFilterType]   = useState('all'); // 'all' | 'binary' | '1x2'
  const [copyStatus, setCopyStatus]   = useState('');
  const [sportStats, setSportStats]   = useState({});
  const [allSportsActive, setAllSportsActive] = useState([]);
  const [totalScanned, setTotalScanned] = useState(0);
  const [filterStats, setFilterStats] = useState(null);
  const [diagResult, setDiagResult]   = useState(null);

  const fetchData = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const r = await fetch('/api/odds');
      const text = await r.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        // La funzione ha restituito HTML invece di JSON
        const preview = text.substring(0, 200).replace(/<[^>]+>/g, ' ').trim();
        throw new Error(`Risposta non-JSON da /api/odds: "${preview}"`);
      }
      if (!r.ok) throw new Error(data?.error || `HTTP ${r.status}`);
      if (data.error) throw new Error(data.error);
      setEvents(data.events || []);
      if (data.apiUsage)       setApiUsage(data.apiUsage);
      if (data.sportStats)     setSportStats(data.sportStats);
      if (data.allSportsActive) setAllSportsActive(data.allSportsActive);
      if (data.totalScanned)   setTotalScanned(data.totalScanned);
      if (data.filterStats)    setFilterStats(data.filterStats);
      setLastUpdate(new Date());
    } catch(e) { setError(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  async function runDiag() {
    setDiagResult('loading');
    try {
      const r = await fetch('/api/test');
      setDiagResult(await r.json());
    } catch(e) { setDiagResult({ status:'ERROR', problem: e.message }); }
  }

  // ─── FILTRAGGIO ────────────────────────────────────────────────────────────
  const arbEvents  = useMemo(() => events.filter(e => e.bestOpportunity?.isArb), [events]);
  const nearEvents = useMemo(() =>
    events.filter(e => !e.bestOpportunity?.isArb &&
      e.bestOpportunity?.profit > -(nearThreshold)),
  [events, nearThreshold]);

  const displayed = showNear ? [...arbEvents, ...nearEvents] : arbEvents;

  const typeFiltered = filterType === '1x2' ? displayed.filter(e => e.hasDraw)
                     : filterType === 'binary' ? displayed.filter(e => !e.hasDraw)
                     : displayed;

  const sports = useMemo(() => [...new Set(events.map(e => e.sport))], [events]);
  const filtered = filterSport === 'all' ? typeFiltered : typeFiltered.filter(e => e.sport === filterSport);

  // ─── COPY ──────────────────────────────────────────────────────────────────
  function copyAll() {
    const lines = [
      '=== SUREBET SCANNER — BACK/LAY ===',
      `Data: ${lastUpdate?.toLocaleString('it-IT')} | Budget: €${budget}`,
      `Commissione Betfair: 5%`,
      '',
      `ARB REALI (${arbEvents.length})`,
      ...arbEvents.map(e => {
        const op = e.bestOpportunity;
        const s = calcStakes(op.backOdds, op.layOddsAdj, budget);
        return `✓ ${e.homeTeam} vs ${e.awayTeam} | ${getSport(e.sport)} | ` +
          `BACK ${op.outcome} @${op.backOdds} [${op.backBookmaker}] €${s.stakeBack} | ` +
          `LAY ${op.outcome} @${op.layOdds} [Betfair] €${s.stakeLay} | ` +
          `Profitto min: +€${s.minProfit}`;
      }),
      '',
      `NEAR-MISS (${nearEvents.length})`,
      ...nearEvents.map(e => {
        const op = e.bestOpportunity;
        return `~ ${e.homeTeam} vs ${e.awayTeam} | gap ${op.profit.toFixed(2)}% | ` +
          `BACK @${op.backOdds} [${op.backBookmaker}] | LAY @${op.layOdds} [Betfair]`;
      }),
    ];
    navigator.clipboard.writeText(lines.join('\n'))
      .then(() => { setCopyStatus('✓ Copiato'); setTimeout(()=>setCopyStatus(''),2500); });
  }

  // ─── STILI ─────────────────────────────────────────────────────────────────
  const tabStyle = active => ({
    background: active ? 'rgba(0,255,136,.1)' : 'transparent',
    border: `1px solid ${active ? '#00ff88' : '#1a1a2e'}`,
    color: active ? '#00ff88' : '#4a4a6a',
    padding: '5px 12px', borderRadius: 4, cursor: 'pointer',
    fontFamily: 'inherit', fontSize: 11, transition: 'all .15s',
  });

  // ─── RENDER ────────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight:'100vh', background:'#05050d', color:'#d0d0e8', fontFamily:"'JetBrains Mono', monospace" }}>

      {/* HEADER */}
      <header style={{ borderBottom:'1px solid #0f0f1e', padding:'16px 24px', background:'#07070f', position:'sticky', top:0, zIndex:10 }}>
        <div style={{ maxWidth:1300, margin:'0 auto', display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap:12 }}>
          <div>
            <div style={{ fontFamily:"'Syne', sans-serif", fontSize:22, fontWeight:800, letterSpacing:4, color:'#fff' }}>
              SURE<span style={{ color:'#00ff88' }}>BET</span>
              <span style={{ fontSize:10, color:'#2a2a5a', marginLeft:10, letterSpacing:3, fontWeight:400 }}>BACK/LAY SCANNER</span>
            </div>
            <div style={{ fontSize:10, color:'#2a2a5a', marginTop:2, letterSpacing:1 }}>
              BOOKMAKER × BETFAIR EXCHANGE — INCLUDE CALCIO 1X2
            </div>
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
            {loading && <div style={{ width:14, height:14, border:'2px solid #1a1a2e', borderTop:'2px solid #00ff88', borderRadius:'50%', animation:'spin .8s linear infinite' }} />}
            {lastUpdate && <span style={{ fontSize:11, color:'#2a2a5a' }}>{lastUpdate.toLocaleTimeString('it-IT')}</span>}
            {apiUsage && (
              <div style={{ display:'flex', gap:6, alignItems:'center', background:'#0a0a18', border:'1px solid #1a1a2e', borderRadius:4, padding:'4px 10px' }}>
                <span style={{ fontSize:10, color:'#2a2a5a', letterSpacing:1 }}>API</span>
                <span style={{ fontSize:13, fontWeight:700, color: apiUsage.remaining < 50 ? '#ff5555' : apiUsage.remaining < 150 ? '#ffaa44' : '#00ff88' }}>
                  {apiUsage.used}/{apiUsage.used + apiUsage.remaining}
                </span>
                <span style={{ fontSize:10, color:'#1a1a3a' }}>({apiUsage.remaining} rimaste)</span>
              </div>
            )}
            <button className="hvr" onClick={runDiag}
              style={{ background:'transparent', border:'1px solid #1a1a2e', color:'#4a4a8a', padding:'6px 12px', borderRadius:4, fontFamily:'inherit', fontSize:11 }}>
              🔑 Test
            </button>
            <button className="hvr" onClick={fetchData} disabled={loading}
              style={{ background:'transparent', border:'1px solid #1a1a2e', color:'#4a4a8a', padding:'6px 12px', borderRadius:4, fontFamily:'inherit', fontSize:11 }}>
              ⟳ Aggiorna <span style={{ fontSize:9, color:'#2a2a4a', marginLeft:3 }}>~{totalScanned*2||50} crediti</span>
            </button>
          </div>
        </div>
      </header>

      <main style={{ maxWidth:1300, margin:'0 auto', padding:'20px 16px' }}>

        {/* DIAGNOSTICA */}
        {diagResult && diagResult !== 'loading' && (
          <div style={{ background: diagResult.status==='OK' ? 'rgba(0,255,136,.05)' : 'rgba(255,80,80,.07)', border:`1px solid ${diagResult.status==='OK'?'rgba(0,255,136,.2)':'rgba(255,80,80,.25)'}`, borderRadius:8, padding:'12px 18px', marginBottom:14, fontSize:12 }}>
            <strong style={{ color: diagResult.status==='OK'?'#00ff88':'#ff7777' }}>
              {diagResult.status==='OK' ? '✓ Chiave valida' : '✗ Problema'}
            </strong>
            {diagResult.status==='OK' ? (
              <span style={{ color:'#8080b0', marginLeft:12 }}>
                Crediti: <strong style={{ color:'#d0d0e8' }}>{diagResult.creditsUsed}</strong> usati,{' '}
                <strong style={{ color: diagResult.creditsRemaining<50?'#ff5555':'#00ff88' }}>{diagResult.creditsRemaining}</strong> rimasti · {diagResult.activeSports} sport attivi
              </span>
            ) : (
              <span style={{ color:'#ff9999', marginLeft:12 }}>{diagResult.problem} {diagResult.fix && `— ${diagResult.fix}`}</span>
            )}
          </div>
        )}

        {/* ERRORE */}
        {error && (
          <div style={{ background:'rgba(255,80,80,.07)', border:'1px solid rgba(255,80,80,.25)', borderRadius:8, padding:'12px 18px', marginBottom:14, fontSize:12, color:'#ff7777' }}>
            ⚠ {error}
          </div>
        )}

        {/* DISCLAIMER */}
        <div style={{ background:'rgba(102,136,255,.05)', border:'1px solid rgba(102,136,255,.15)', borderRadius:8, padding:'10px 16px', marginBottom:16, fontSize:11, color:'#6688ff', display:'flex', gap:10, alignItems:'center' }}>
          <span>🔬</span>
          <span>
            <strong>Back/Lay Arbitraggio</strong> — Back su bookmaker tradizionale + Lay su Betfair Exchange.
            Funziona anche per il calcio 1X2: fare Lay di "Casa" copre sia Pareggio che Ospite.
            Commissione Betfair applicata: <strong>5%</strong>.
          </span>
        </div>

        {/* CONTROLLI */}
        <div style={{ background:'#0a0a16', border:'1px solid #0f0f1e', borderRadius:10, padding:'16px 20px', marginBottom:18, display:'flex', flexWrap:'wrap', gap:20, alignItems:'center' }}>

          {/* Stats */}
          <div style={{ display:'flex', gap:28, flexWrap:'wrap' }}>
            {[
              { n: arbEvents.length,  l:'arb reali',          c:'#00ff88' },
              { n: nearEvents.length, l:`near ≤${nearThreshold}%`, c:'#ffaa44' },
              { n: events.length,     l:'eventi totali',       c:'#6688ff' },
              { n: filterStats?.passedWithDraw||0, l:'calcio 1X2', c:'#88ccff' },
            ].map(s => (
              <div key={s.l} style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:2 }}>
                <span style={{ fontSize:26, fontWeight:800, color:s.c, lineHeight:1, fontFamily:"'Syne',sans-serif" }}>{s.n}</span>
                <span style={{ fontSize:10, color:'#2a2a5a' }}>{s.l}</span>
              </div>
            ))}
          </div>

          <div style={{ flex:1 }} />

          {/* Budget */}
          <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
            <span style={{ fontSize:10, color:'#2a2a5a', letterSpacing:1 }}>BUDGET (€)</span>
            <div style={{ display:'flex', gap:6 }}>
              {[50,100,200,500,1000].map(v => (
                <button key={v} onClick={()=>setBudget(v)} style={tabStyle(budget===v)}>{v}</button>
              ))}
            </div>
          </div>

          {/* Near threshold */}
          <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
            <span style={{ fontSize:10, color:'#2a2a5a', letterSpacing:1 }}>NEAR-MISS ENTRO</span>
            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
              <input type="range" min="0.5" max="10" step="0.5" value={nearThreshold}
                onChange={e=>setNearThreshold(parseFloat(e.target.value))}
                style={{ accentColor:'#ffaa44', width:90, cursor:'pointer' }} />
              <span style={{ fontSize:12, color:'#ffaa44', fontWeight:600, minWidth:30 }}>{nearThreshold}%</span>
              <button onClick={()=>setShowNear(s=>!s)} style={tabStyle(showNear)}>
                {showNear?'Nascondi':'Mostra'}
              </button>
            </div>
          </div>
        </div>

        {/* FILTRI */}
        <div style={{ display:'flex', gap:6, flexWrap:'wrap', marginBottom:14 }}>
          {/* Tipo mercato */}
          <div style={{ display:'flex', gap:4, marginRight:12 }}>
            {[['all','Tutti'],['binary','Solo binari'],['1x2','Solo 1X2 calcio']].map(([v,l]) => (
              <button key={v} onClick={()=>setFilterType(v)} style={tabStyle(filterType===v)}>{l}</button>
            ))}
          </div>
          {/* Sport */}
          {sports.length > 1 && ['all',...sports].map(sp => (
            <button key={sp} onClick={()=>setFilterSport(sp)} style={tabStyle(filterSport===sp)}>
              {sp==='all'?'Tutti gli sport':getSport(sp)}
            </button>
          ))}
        </div>

        {/* LEGENDA */}
        <div style={{ fontSize:11, color:'#2a2a5a', marginBottom:18, display:'flex', gap:20, flexWrap:'wrap' }}>
          <span><span style={{ color:'#00ff88' }}>●</span> ARB REALE — profitto garantito qualunque sia l'esito</span>
          <span><span style={{ color:'#ffaa44' }}>●</span> NEAR-MISS — monitorare, la finestra può aprirsi</span>
          <span><span style={{ color:'#88ccff' }}>●</span> Calcio 1X2 — Lay copre 2 esiti su 3</span>
        </div>

        {/* LOADING */}
        {loading && !events.length && (
          <div style={{ display:'flex', alignItems:'center', gap:12, color:'#2a2a5a', fontSize:13, padding:'60px 0', justifyContent:'center' }}>
            <div style={{ width:18, height:18, border:'2px solid #0f0f1e', borderTop:'2px solid #00ff88', borderRadius:'50%', animation:'spin .8s linear infinite' }} />
            Scansione Back/Lay su tutti i mercati…
          </div>
        )}

        {/* NESSUN RISULTATO */}
        {!loading && !error && !filtered.length && (
          <div style={{ textAlign:'center', color:'#2a2a5a', fontSize:13, padding:'60px 20px', lineHeight:2.2 }}>
            {events.length === 0
              ? 'Nessun evento recuperato — premi Aggiorna o controlla la chiave API.'
              : 'Nessuna opportunità di arbitraggio aperta in questo momento.'
            }<br/>
            <small>Le finestre di arb durano pochi minuti — aggiorna frequentemente nei periodi con più partite.</small>
            {!showNear && events.length > 0 && (
              <><br/>
              <button onClick={()=>setShowNear(true)} style={{ ...tabStyle(false), marginTop:16, padding:'8px 20px' }}>
                Mostra near-miss
              </button></>
            )}
          </div>
        )}

        {/* CARDS */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(500px, 1fr))', gap:14, marginBottom:32 }}>
          {filtered.map(ev => <BackLayCard key={ev.id} event={ev} budget={budget} />)}
        </div>

        {/* DEBUG */}
        <details style={{ border:'1px solid #0f0f1e', borderRadius:8, overflow:'hidden' }}>
          <summary style={{ padding:'12px 18px', fontSize:12, color:'#2a2a5a', cursor:'pointer', background:'#0a0a16', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
            <span>📊 Debug — {totalScanned} sport · {events.length} eventi · filtri pipeline</span>
            <button className="hvr" onClick={e=>{e.preventDefault();copyAll();}}
              style={{ background:copyStatus?'rgba(0,255,136,.12)':'transparent', border:`1px solid ${copyStatus?'#00ff88':'#1a1a2e'}`, color:copyStatus?'#00ff88':'#4a4a6a', padding:'4px 12px', borderRadius:4, fontFamily:'inherit', fontSize:11 }}>
              {copyStatus||'📋 Esporta'}
            </button>
          </summary>

          {/* Filter stats */}
          {filterStats && (
            <div style={{ background:'#06060e', borderBottom:'1px solid #0f0f1e', padding:'12px 16px', display:'flex', flexWrap:'wrap', gap:8 }}>
              <span style={{ fontSize:10, color:'#2a2a5a', letterSpacing:1, width:'100%', marginBottom:4 }}>PIPELINE FILTRI</span>
              {[
                { l:'Tot. ricevuti', v:filterStats.total, c:'#6688ff' },
                { l:'Senza BK', v:filterStats.noBookmakers, c:'#333355' },
                { l:'Senza LAY', v:filterStats.noLayOdds, c:'#553333' },
                { l:'Con pareggio', v:filterStats.withDraw, c:'#886644' },
                { l:'✓ Passati', v:filterStats.passed, c:'#00ff88' },
                { l:'di cui 1X2', v:filterStats.passedWithDraw, c:'#88ccff' },
              ].map(s => (
                <div key={s.l} style={{ background:'rgba(255,255,255,.02)', border:'1px solid #0f0f1e', borderRadius:4, padding:'5px 10px', textAlign:'center' }}>
                  <div style={{ fontSize:16, fontWeight:700, color:s.c }}>{s.v}</div>
                  <div style={{ fontSize:9, color:'#2a2a5a' }}>{s.l}</div>
                </div>
              ))}
            </div>
          )}

          {/* Sport coverage */}
          <div style={{ background:'#06060e', borderBottom:'1px solid #0f0f1e', padding:'12px 16px' }}>
            <div style={{ fontSize:10, color:'#2a2a5a', letterSpacing:1, marginBottom:8 }}>SPORT SCANSIONATI ({totalScanned})</div>
            <div style={{ display:'flex', flexWrap:'wrap', gap:5 }}>
              {allSportsActive.map(sp => {
                const count = sportStats[sp.key]?.count || 0;
                return (
                  <div key={sp.key} style={{ background:count>0?'rgba(0,255,136,.07)':'rgba(255,255,255,.02)', border:`1px solid ${count>0?'rgba(0,255,136,.2)':'#0f0f1e'}`, borderRadius:4, padding:'3px 8px', display:'flex', alignItems:'center', gap:5 }}>
                    <span style={{ fontSize:10, color:count>0?'#c0e0c0':'#2a2a4a' }}>{sp.title}</span>
                    {count > 0 && <span style={{ fontSize:10, fontWeight:700, color:'#00ff88', background:'rgba(0,255,136,.15)', padding:'1px 5px', borderRadius:3 }}>{count}</span>}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Events table */}
          <div style={{ background:'#07070f', maxHeight:360, overflowY:'auto' }}>
            <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr .8fr 1.5fr 1.5fr .8fr', padding:'7px 16px', fontSize:9, color:'#2a2a5a', letterSpacing:1, borderBottom:'1px solid #0f0f1e', textTransform:'uppercase', position:'sticky', top:0, background:'#07070f' }}>
              <span>Evento</span><span>Sport</span><span>Tipo</span><span>Back (migliore)</span><span>Lay Betfair</span><span>Gap</span>
            </div>
            {events.map(ev => {
              const op = ev.bestOpportunity;
              const isArb = op?.isArb;
              return (
                <div key={ev.id} style={{ display:'grid', gridTemplateColumns:'2fr 1fr .8fr 1.5fr 1.5fr .8fr', padding:'6px 16px', borderBottom:'1px solid #0a0a14', background:isArb?'rgba(0,255,136,.03)':'transparent' }}>
                  <span style={{ fontSize:11, color:isArb?'#c0f0d0':'#8080a0', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                    {isArb?'✓ ':''}{ev.homeTeam} vs {ev.awayTeam}
                  </span>
                  <span style={{ fontSize:10, color:'#3a3a6a' }}>{getSport(ev.sport).split(' ').slice(1,3).join(' ')}</span>
                  <span style={{ fontSize:10, color: ev.hasDraw?'#88ccff':'#6688ff' }}>{ev.hasDraw?'1X2':'binario'}</span>
                  <span style={{ fontSize:10, color:'#6060a0' }}>
                    {op?.outcome?.substring(0,14)} <strong style={{ color:'#8888cc' }}>{op?.backOdds}</strong>
                    <span style={{ color:'#3a3a6a' }}> [{op?.backBookmaker?.substring(0,8)}]</span>
                  </span>
                  <span style={{ fontSize:10, color:'#6060a0' }}>
                    {op?.outcome?.substring(0,14)} <strong style={{ color:'#8888cc' }}>{op?.layOdds}</strong>
                    {op?.usedLayOdds==='back_proxy' && <span style={{ color:'#443333' }}> [~]</span>}
                  </span>
                  <span style={{ fontSize:11, color:isArb?'#00ff88':op?.profit>-nearThreshold?'#ffaa44':'#444466', fontWeight:600 }}>
                    {op?.profit > 0 ? '+' : ''}{op?.profit?.toFixed(2)}%
                  </span>
                </div>
              );
            })}
          </div>
        </details>

      </main>
    </div>
  );
}

// ─── BACK/LAY CARD ───────────────────────────────────────────────────────────
function BackLayCard({ event, budget }) {
  const { homeTeam, awayTeam, sport, commenceTime, hasDraw, bookmakerCount,
          bestOpportunity: op, backLayOpps, hasRealLay, spread } = event;
  const [expanded, setExpanded] = useState(false);

  const isArb = op?.isArb;
  const stakes = op ? calcStakes(op.backOdds, op.layOddsAdj, budget) : null;

  return (
    <div className={isArb ? 'arb-card' : 'near-card'}
      style={{ background:'#0a0a16', border:`1px solid ${isArb?'rgba(0,255,136,.4)':'rgba(255,170,68,.2)'}`, borderRadius:10, padding:'16px 18px', position:'relative' }}>

      {/* Badge */}
      <div style={{ position:'absolute', top:-1, right:14, background:isArb?'#00ff88':'#ffaa44', color:'#000', fontSize:9, fontWeight:800, padding:'2px 10px', borderRadius:'0 0 6px 6px', letterSpacing:1.5 }}>
        {isArb ? `ARB +${op?.profit?.toFixed(2)}%` : `GAP ${op?.profit?.toFixed(2)}%`}
      </div>

      {/* Titolo */}
      <div style={{ marginBottom:12, paddingRight:90 }}>
        <div style={{ fontSize:14, fontWeight:700, color:'#f0f0ff', fontFamily:"'Syne',sans-serif", marginBottom:5 }}>
          {homeTeam} vs {awayTeam}
        </div>
        <div style={{ display:'flex', gap:12, flexWrap:'wrap', alignItems:'center' }}>
          <span style={{ fontSize:10, color:'#2a2a5a' }}>{getSport(sport)}</span>
          {commenceTime && <span style={{ fontSize:10, color:'#2a2a5a' }}>🕐 {fmtDate(commenceTime)}</span>}
          <span style={{ fontSize:10, color:'#2a2a5a' }}>📚 {bookmakerCount} BK</span>
          {hasDraw && <span style={{ fontSize:10, color:'#88ccff', background:'rgba(136,204,255,.1)', padding:'1px 6px', borderRadius:3 }}>1X2</span>}
          {!hasRealLay && <span style={{ fontSize:10, color:'#664444', background:'rgba(255,80,80,.08)', padding:'1px 6px', borderRadius:3 }}>~lay stimato</span>}
        </div>
        {hasDraw && (
          <div style={{ marginTop:6, fontSize:11, color:'#6688aa', background:'rgba(102,136,170,.06)', border:'1px solid rgba(102,136,170,.15)', borderRadius:4, padding:'4px 8px' }}>
            💡 Fare LAY di <strong style={{ color:'#88ccff' }}>{op?.outcome}</strong> su Betfair copre automaticamente gli altri 2 esiti
          </div>
        )}
      </div>

      <div style={{ borderTop:'1px solid #0f0f1e', marginBottom:12 }} />

      {/* Lato BACK */}
      <div style={{ display:'flex', alignItems:'center', gap:10, background:'rgba(102,136,255,.06)', border:'1px solid rgba(102,136,255,.15)', borderRadius:7, padding:'10px 14px', marginBottom:8 }}>
        <div style={{ fontSize:11, color:'#6688ff', fontWeight:800, minWidth:40, textAlign:'center', background:'rgba(102,136,255,.12)', padding:'2px 6px', borderRadius:3 }}>BACK</div>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:13, color:'#d0d0f0', fontWeight:600 }}>Vince <strong>{op?.outcome}</strong></div>
          <div style={{ fontSize:11, color:'#3a3a6a', marginTop:2 }}>
            {op?.backBookmaker} · Quota <strong style={{ color:'#8888cc' }}>{op?.backOdds}</strong>
          </div>
        </div>
        <div style={{ textAlign:'right' }}>
          <div style={{ fontSize:18, fontWeight:700, color:'#6688ff' }}>{stakes ? fmtEur(stakes.stakeBack) : '—'}</div>
          <div style={{ fontSize:10, color:'#2a2a5a' }}>da puntare</div>
        </div>
      </div>

      {/* Lato LAY */}
      <div style={{ display:'flex', alignItems:'center', gap:10, background:'rgba(0,255,136,.04)', border:'1px solid rgba(0,255,136,.15)', borderRadius:7, padding:'10px 14px', marginBottom:12 }}>
        <div style={{ fontSize:11, color:'#00ff88', fontWeight:800, minWidth:40, textAlign:'center', background:'rgba(0,255,136,.12)', padding:'2px 6px', borderRadius:3 }}>LAY</div>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:13, color:'#d0d0f0', fontWeight:600 }}>
            Contro <strong>{op?.outcome}</strong>
            {hasDraw && <span style={{ fontSize:10, color:'#88ccff', marginLeft:6 }}>(= punta sugli altri 2 esiti)</span>}
          </div>
          <div style={{ fontSize:11, color:'#2a6a4a', marginTop:2 }}>
            Betfair Exchange · Quota LAY <strong style={{ color:'#8888cc' }}>{op?.layOdds}</strong>
            {' '}→ adj. comm. 5%: <strong style={{ color:'#6699aa' }}>{op?.layOddsAdj}</strong>
          </div>
        </div>
        <div style={{ textAlign:'right' }}>
          <div style={{ fontSize:18, fontWeight:700, color:'#00ff88' }}>{stakes ? fmtEur(stakes.stakeLay) : '—'}</div>
          <div style={{ fontSize:10, color:'#2a2a5a' }}>da puntare</div>
        </div>
      </div>

      {/* Profitti */}
      {stakes && (
        <div style={{ background:isArb?'rgba(0,255,136,.06)':'rgba(255,170,68,.04)', border:`1px solid ${isArb?'rgba(0,255,136,.18)':'rgba(255,170,68,.15)'}`, borderRadius:7, padding:'10px 14px', marginBottom:10 }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
            <div>
              <div style={{ fontSize:10, color:'#2a2a5a', letterSpacing:1, marginBottom:4 }}>
                {isArb ? '✓ PROFITTO GARANTITO — qualunque sia l\'esito' : '⏳ NEAR-MISS — finestra non aperta'}
              </div>
              <div style={{ display:'flex', gap:16, fontSize:11 }}>
                <span style={{ color:'#4a4a8a' }}>
                  Se <strong style={{ color:'#8080b0' }}>{op?.outcome}</strong> vince:
                  <strong style={{ color: parseFloat(stakes.profitIfWin)>=0?'#00ff88':'#ff5555', marginLeft:4 }}>{parseFloat(stakes.profitIfWin)>=0?'+':''}{fmtEur(stakes.profitIfWin)}</strong>
                </span>
                <span style={{ color:'#4a4a8a' }}>
                  Se non vince:
                  <strong style={{ color: parseFloat(stakes.profitIfLose)>=0?'#00ff88':'#ff5555', marginLeft:4 }}>{parseFloat(stakes.profitIfLose)>=0?'+':''}{fmtEur(stakes.profitIfLose)}</strong>
                </span>
              </div>
            </div>
            <div style={{ textAlign:'right' }}>
              <div style={{ fontSize:24, fontWeight:800, color:isArb?'#00ff88':'#ffaa44', fontFamily:"'Syne',sans-serif", lineHeight:1 }}>
                {parseFloat(stakes.minProfit)>=0?'+':''}{fmtEur(stakes.minProfit)}
              </div>
              <div style={{ fontSize:10, color:'#2a2a5a', marginTop:2 }}>profitto minimo garantito</div>
            </div>
          </div>
        </div>
      )}

      {/* Tutte le opportunità */}
      {backLayOpps?.length > 1 && (
        <button onClick={()=>setExpanded(e=>!e)}
          style={{ background:'transparent', border:'1px solid #0f0f1e', color:'#2a2a5a', padding:'4px 12px', borderRadius:4, cursor:'pointer', fontFamily:'inherit', fontSize:10, width:'100%', letterSpacing:1, marginBottom: expanded?8:0 }}>
          {expanded ? '▲ Nascondi' : `▼ Tutti gli esiti (${backLayOpps.length})`}
        </button>
      )}

      {expanded && backLayOpps && (
        <div style={{ background:'#07070f', border:'1px solid #0f0f1e', borderRadius:6, overflow:'hidden' }}>
          <div style={{ display:'grid', gridTemplateColumns:'2fr 1fr 1fr 1fr 1fr', padding:'6px 12px', fontSize:9, color:'#2a2a5a', letterSpacing:1, borderBottom:'1px solid #0f0f1e', textTransform:'uppercase' }}>
            <span>Esito</span><span>Back</span><span>BK</span><span>Lay</span><span>Gap</span>
          </div>
          {backLayOpps.map((opp, i) => (
            <div key={i} style={{ display:'grid', gridTemplateColumns:'2fr 1fr 1fr 1fr 1fr', padding:'6px 12px', borderBottom:'1px solid #0a0a14', background:opp.isArb?'rgba(0,255,136,.04)':'transparent' }}>
              <span style={{ fontSize:11, color:'#8080b0', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{opp.outcome}</span>
              <span style={{ fontSize:11, color:'#8888cc' }}>{opp.backOdds}</span>
              <span style={{ fontSize:10, color:'#3a3a6a', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{opp.backBookmaker}</span>
              <span style={{ fontSize:11, color:'#8888cc' }}>{opp.layOdds}</span>
              <span style={{ fontSize:11, color:opp.isArb?'#00ff88':opp.profit>-3?'#ffaa44':'#444466', fontWeight:600 }}>
                {opp.profit>0?'+':''}{opp.profit?.toFixed(2)}%
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
