import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Toast';
import Sheet from '../components/Sheet';
import { createCommunityEvent, watchCommunityEvents, joinCommunityEvent, leaveCommunityEvent } from '../lib/db';
import { listEstablishments, type Establishment } from '../lib/establishments';
import type { CommunityEvent } from '../lib/types';
import { useNavigate } from 'react-router-dom';

export default function EventsPage(){
  const { profile }=useAuth();
  const { toast }=useToast();
  const nav=useNavigate();
  const [events, setEvents]=useState<CommunityEvent[]>([]);
  const [establishments, setEstablishments]=useState<Establishment[]>([]);
  const [open, setOpen]=useState(false);
  const [title,setTitle]=useState('');
  const [desc,setDesc]=useState('');
  const [date,setDate]=useState(new Date().toISOString().slice(0,10));
  const [time,setTime]=useState('10:00');
  const [estId,setEstId]=useState('');
  const [busy,setBusy]=useState(false);

  useEffect(()=>watchCommunityEvents(setEvents),[]);
  useEffect(()=>{ listEstablishments().then(setEstablishments).catch(()=>undefined); },[]);

  const create=async()=>{
    if(!profile) return;
    if(!title.trim()) { toast('Titre requis','error'); return; }
    setBusy(true);
    try{
      const est = establishments.find(e=>e.id===estId);
      await createCommunityEvent(profile, {
        title: title.trim(),
        description: desc.trim()||'Sortie communautaire ElyWalk',
        establishmentId: est?.id||undefined,
        establishmentName: est?.name||undefined,
        location: est?.address||undefined,
        lat: est?.lat||undefined,
        lng: est?.lng||undefined,
        date, time,
      });
      toast('Événement créé !','success');
      setOpen(false); setTitle(''); setDesc('');
    }catch(e){ toast((e as Error).message,'error'); } finally{ setBusy(false); }
  };

  const toggleJoin=async(ev:CommunityEvent)=>{
    if(!profile) return;
    const joined=ev.participants.includes(profile.uid);
    try{
      if(joined) await leaveCommunityEvent(profile.uid, ev.id!);
      else await joinCommunityEvent(profile.uid, ev.id!);
      toast(joined?'Désinscrit':'Inscrit !','success');
    }catch(e){ toast((e as Error).message,'error'); }
  };

  return <div className="screen" data-testid="events-screen">
    <div className="screen-header"><div><h1 className="screen-title">Rencontres</h1><div className="screen-sub">Marcher ensemble · établissements partenaires</div></div><button className="btn btn-ghost btn-sm" onClick={()=>nav(-1)}>Retour</button></div>
    <div className="card" style={{display:'flex', flexDirection:'column', gap:8}}>
      <div className="card-title">Sorties communautaires Elysium</div>
      <p className="card-help">Organisez ou rejoignez une marche groupée liée aux établissements de la carte. Idéal pour découvrir les partenaires et se motiver ensemble.</p>
      <button className="btn btn-gold" onClick={()=>setOpen(true)}>+ Proposer une sortie</button>
    </div>
    {events.length===0 ? <div className="card empty-state"><div className="display">Aucun événement</div>Soyez le premier à proposer une marche ensemble !</div> :
      events.map(ev=>(
        <div key={ev.id} className="card" data-testid="event-card">
          <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-start'}}>
            <div>
              <div style={{fontWeight:700}}>{ev.title}</div>
              <div className="row-sub">{ev.date} {ev.time||''} {ev.establishmentName? `· 📍 ${ev.establishmentName}` : ev.location? `· ${ev.location}`:''}</div>
            </div>
            <span className="badge">{ev.participants.length} inscrits</span>
          </div>
          <p style={{marginTop:8, color:'var(--muted)', fontSize:13}}>{ev.description}</p>
          {profile && <button className={`btn btn-sm ${ev.participants.includes(profile.uid)?'btn-danger':'btn-gold'}`} style={{marginTop:10, width:'100%'}} onClick={()=>toggleJoin(ev)}>{ev.participants.includes(profile.uid)?'Se désinscrire':'Rejoindre'}</button>}
          <small style={{color:'var(--muted)', display:'block', marginTop:6}}>Créé par {ev.creatorName}</small>
        </div>
      ))
    }
    <Sheet open={open} onClose={()=>setOpen(false)} title="Nouvel événement">
      <div className="field"><label>Titre</label><input className="input" value={title} onChange={e=>setTitle(e.target.value)} maxLength={80} placeholder="ex. Marche matinale au parc" /></div>
      <div className="field"><label>Description</label><textarea className="input" value={desc} onChange={e=>setDesc(e.target.value)} maxLength={600} rows={3} placeholder="Détails, point de rendez-vous..." /></div>
      <div className="two-col"><div className="field"><label>Date</label><input className="input" type="date" value={date} onChange={e=>setDate(e.target.value)} /></div><div className="field"><label>Heure</label><input className="input" type="time" value={time} onChange={e=>setTime(e.target.value)} /></div></div>
      <div className="field"><label>Établissement partenaire (optionnel)</label>
        <select className="input" value={estId} onChange={e=>setEstId(e.target.value)}>
          <option value="">Aucun — lieu libre</option>
          {establishments.map(est=><option key={est.id} value={est.id}>{est.name}</option>)}
        </select>
      </div>
      <button className="btn btn-gold" onClick={create} disabled={busy}>{busy?'Création...':'Créer'}</button>
    </Sheet>
  </div>;
}
