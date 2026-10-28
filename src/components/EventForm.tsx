import {useState} from 'react'
import {ArrowLeft, Plus, Trash2, LoaderCircle, UserRound, Baby} from 'lucide-react'
import {formatDate, friendlyError, rpc, validParticipants} from '../lib/api'
import type {ExchangeEvent, DraftParticipant} from '../lib/api'
export function EventForm({event,onSaved,onCancel}: {event?:ExchangeEvent;onSaved:(id:string)=>void;onCancel:()=>void}) {
  const [title,setTitle]=useState(event?.title??'')
  const [date,setDate]=useState(event?.event_date??'')
  const [budget,setBudget]=useState(event?.budget??'Libre')
  const [gift,setGift]=useState(event?.gift_type??'')
  const [people,setPeople]=useState<DraftParticipant[]>([])
  const [name,setName]=useState('')
  const [child,setChild]=useState(false)
  const [guardian,setGuardian]=useState('')
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  function add() {
    if(people.length>=100) {setError('El límite es de 100 participantes por evento.');return}
    const p={name:name.trim(),is_child:child,...(child?{guardian_index:Number(guardian)}:{})}
    if (!p.name) return
    if(child && guardian==='') {setError('Selecciona un adulto responsable.'); return}
    if(people.some(x=>x.name.toLocaleLowerCase('es-MX')===p.name.toLocaleLowerCase('es-MX'))) {setError('Ese nombre ya está en la lista.');return}
    setPeople([...people,p]);setName('');setChild(false);setGuardian('');setError('')
  }
  function remove(index:number) {
    const removed=new Set([index,...people.flatMap((p,i)=>p.guardian_index===index?[i]:[])])
    setPeople(people.filter((_,i)=>!removed.has(i)).map(p=>({...p,...(p.guardian_index!==undefined?{guardian_index:p.guardian_index-[...removed].filter(i=>i<p.guardian_index!).length}:{})})))
    setGuardian('')
  }
  async function submit(e:React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault();setError('')
    if(busy)return
    if(!title.trim()){setError('Escribe el título del evento.');return}
    const validation = event ? null : validParticipants(people)
    if(validation){setError(validation);return}
    setBusy(true)
    try {
      const args={p_title:title.trim(),p_event_date:date,p_budget:budget,p_gift_type:gift.trim()}
      const id=event ? (await rpc('update_event',{...args,p_event_id:event.id}),event.id) : await rpc<string>('create_event',{...args,p_participants:people})
      onSaved(id)
    }catch(err){setError(friendlyError(err))}finally{setBusy(false)}
  }
  return <section className="screen"><button className="btn-text -ml-3 mb-3" onClick={onCancel}><ArrowLeft size={17}/>Volver</button>
    <h1 className="heading">{event?'Editar evento':'Configurar evento'}</h1><p className="subheading">{event?'Ajusta los detalles de tu intercambio.':'Los buenos regalos empiezan aquí.'}</p>
    <form onSubmit={submit}>
      <label className="label" htmlFor="event-title">Título del evento</label><input id="event-title" className="field" required maxLength={100} placeholder="Ej. Cena de Navidad" value={title} onChange={e=>setTitle(e.target.value)}/>
      <label className="label" htmlFor="event-date">Fecha</label><input id="event-date" type="date" className="field" required value={date} onChange={e=>setDate(e.target.value)}/>
      <div className="grid grid-cols-2 gap-3"><div><label className="label" htmlFor="budget">Presupuesto</label><select id="budget" className="field" value={budget} onChange={e=>setBudget(e.target.value)}>{['Libre',...Array.from({length:19},(_,i)=>`$${(i+2)*50}`)].map(b=><option key={b}>{b}</option>)}</select></div><div><label className="label" htmlFor="gift">¿Qué se regala?</label><input id="gift" className="field" maxLength={80} placeholder="Ej. Pijamas" value={gift} onChange={e=>setGift(e.target.value)}/></div></div>
      {!event&&<><label className="label" htmlFor="participant-name">Participantes <span className="float-right">{people.length}/100</span></label>
      <div className="flex gap-2"><input id="participant-name" className="field" placeholder="Nombre…" maxLength={80} value={name} onChange={e=>setName(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();add()}}}/><button type="button" aria-label="Agregar participante" className="btn-primary !w-13 !shrink-0 !px-0" disabled={people.length>=100} onClick={add}><Plus size={21}/></button></div>
      <label className="mt-3 flex items-center gap-2 text-sm text-gray-500"><input type="checkbox" className="size-4 accent-gray-900" checked={child} onChange={e=>setChild(e.target.checked)}/>Dependiente</label>
      {child&&<select aria-label="Adulto responsable" className="field mt-3" value={guardian} onChange={e=>setGuardian(e.target.value)}><option value="">Selecciona su adulto responsable</option>{people.map((p,i)=>!p.is_child&&<option key={i} value={i}>{p.name}</option>)}</select>}
      <div className="mt-4 max-h-60 space-y-2 overflow-y-auto rounded-xl border border-dashed border-gray-200 p-2 dark:border-gray-800">
        {people.length===0?<p className="py-5 text-center text-xs text-gray-400">Agrega al menos 2 personas</p>:people.map((p,i)=><div key={i} className="flex items-center justify-between gap-2 rounded-lg bg-gray-50 px-3 py-2 dark:bg-gray-900"><div className="flex min-w-0 items-center gap-2">{p.is_child?<Baby size={16}/>:<UserRound size={16}/>}<span className="truncate text-sm font-semibold">{p.name}</span>{p.is_child&&<span className="text-[10px] text-gray-400">con {people[p.guardian_index!]?.name}</span>}</div><button type="button" className="icon-button !size-8 hover:!text-red-500" aria-label={`Quitar a ${p.name}`} onClick={()=>remove(i)}><Trash2 size={15}/></button></div>)}
      </div><p className="mt-3 text-xs leading-relaxed text-gray-400">Crearás un borrador. Podrás compartir las invitaciones y hacer el sorteo cuando todo esté listo.</p></>}
      {error&&<p role="alert" className="mt-4 text-sm text-red-600 dark:text-red-400">{error}</p>}
      <button className="btn-primary mt-7" disabled={busy}>{busy?<LoaderCircle size={19} className="animate-spin"/>:<Plus size={18}/>} {event?'Guardar cambios':'Crear evento'}</button>
      {event&&<p className="mt-3 text-center text-xs text-gray-400">Fecha actual: {formatDate(event.event_date)}</p>}
      <button type="button" onClick={onCancel} className="btn-text mx-auto mt-2">Cancelar</button>
    </form>
  </section>
}
