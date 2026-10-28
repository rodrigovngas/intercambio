import {useEffect,useState} from 'react'
import {ArrowLeft,Archive,RotateCcw,CalendarDays,Gift,Users,Link as LinkIcon,Pencil,Shuffle,Copy,Share2,LoaderCircle,Plus,X,RefreshCw,ChevronRight,CheckCircle2,Trash2,KeyRound} from 'lucide-react'
import {QRCodeSVG} from 'qrcode.react'
import confetti from 'canvas-confetti'
import {Modal} from './Modal'
import {EventForm} from './EventForm'
import {loadEvent,rpc,formatDate,friendlyError,invitationUrl} from '../lib/api'
import type {Assignment,ExchangeEvent,Participant,Invitation} from '../lib/api'
export function EventDashboard({id,userId,onBack,onToast}:{id:string;userId:string;onBack:()=>void;onToast:(s:string)=>void}) {
  const [event,setEvent]=useState<ExchangeEvent|null>(null)
  const [people,setPeople]=useState<Participant[]>([])
  const [loading,setLoading]=useState(true)
  const [error,setError]=useState('')
  const [busy,setBusy]=useState(false)
  const [editing,setEditing]=useState(false)
  const [invites,setInvites]=useState<Invitation[]>([])
  const [invite,setInvite]=useState<Invitation|null>(null)
  const [confirm,setConfirm]=useState<'draw'|'redraw'|'archive'|'delete'|null>(null)
  const [confirmationWord,setConfirmationWord]=useState('')
  const [resettingInvite,setResettingInvite]=useState<Invitation|null>(null)
  const [addOpen,setAddOpen]=useState(false)
  const [newName,setNewName]=useState('')
  const [newChild,setNewChild]=useState(false)
  const [guardian,setGuardian]=useState('')
  const [active,setActive]=useState('')
  const [assignment,setAssignment]=useState<Assignment|null>(null)
  const [wishes,setWishes]=useState(['','',''])
  const [extra,setExtra]=useState('')
  const [invitesOpen,setInvitesOpen]=useState(false)
  const owner=event?.owner_id===userId
  const mine=people.filter(p=>p.user_id===userId||people.some(g=>g.id===p.guardian_id&&g.user_id===userId))
  const profile=mine.find(p=>p.id===active)??mine[0]
  const myIds=mine.map(p=>p.id).join(',')
  const selectedInviteToken=invite?.token??null
  async function refresh() {
    setError('')
    try {const result=await loadEvent(id);setEvent(result.event);setPeople(result.participants)}catch(e){setError(friendlyError(e))}finally{setLoading(false)}
  }
  useEffect(()=>{let stopped=false;setLoading(true);loadEvent(id).then(r=>{if(!stopped){setEvent(r.event);setPeople(r.participants)}}).catch(e=>{if(!stopped)setError(friendlyError(e))}).finally(()=>{if(!stopped)setLoading(false)});return()=>{stopped=true}},[id])
  useEffect(()=>{setAssignment(null)},[profile?.id,myIds,event?.drawn_at])
  useEffect(()=>{if(profile){setWishes([0,1,2].map(i=>profile.wishes?.[i]??''));setExtra(profile.extra??'')}},[profile?.id,myIds])
  async function action(fn:()=>Promise<void>) {setBusy(true);setError('');try{await fn()}catch(e){setError(friendlyError(e))}finally{setBusy(false)}}
  async function showInvites(){await action(async()=>{const data=await rpc<Invitation[]>('get_participant_invites',{p_event_id:id});setInvites(data);setInvitesOpen(true)})}
  async function copy(text:string){try{await navigator.clipboard.writeText(text);onToast('Enlace copiado')}catch{setError('No se pudo copiar. Mantén presionado el enlace para seleccionarlo.')}}
  async function share(text:string,name:string){if(navigator.share){try{await navigator.share({title:`Intercambio · ${event?.title}`,text:`${name}, esta es tu invitación personal.`,url:text})}catch(e){if(!(e instanceof DOMException&&e.name==='AbortError')) await copy(text)}}else await copy(text)}
  async function confirmAction(){
    if(!confirm||!event||busy||(confirm==='delete'&&confirmationWord!=='ELIMINAR'))return
    const type=confirm
    await action(async()=>{
      if(type==='delete'){
        await rpc('delete_event',{p_event_id:id,p_confirmation:confirmationWord})
        setConfirm(null)
        onToast('Evento eliminado definitivamente')
        onBack()
        return
      }
      if(type==='archive')await rpc('archive_event',{p_event_id:id,p_archived:event.status!=='archived'})
      else await rpc('draw_event',{p_event_id:id,p_expected_drawn_at:type==='redraw'?event.drawn_at:null})
      setConfirm(null)
      setAssignment(null)
      await refresh()
      onToast(type==='archive'?'Evento actualizado':'¡Sorteo listo!')
    })
  }
  if(loading)return <div className="flex justify-center py-20" role="status" aria-label="Cargando evento"><LoaderCircle className="animate-spin"/></div>
  if(!event)return <><button className="btn-text" onClick={onBack}><ArrowLeft size={17}/>Volver</button><p role="alert" className="py-10 text-center text-sm text-gray-500">{error||'Evento no encontrado.'}</p></>
  if(editing)return <EventForm event={event} onCancel={()=>setEditing(false)} onSaved={()=>{setEditing(false);void refresh();onToast('Evento actualizado')}}/>
  return <section className="screen">
    <div className="mb-5 flex items-center justify-between"><button className="btn-text -ml-3" onClick={onBack}><ArrowLeft size={17}/>Mis eventos</button><button className="icon-button" aria-label="Actualizar evento" disabled={busy} onClick={()=>void action(refresh)}><RefreshCw size={17}/></button></div>
    <h1 className="heading break-words">{event.title}</h1>
    <div className="mt-4 flex flex-wrap justify-center gap-2"><span className="pill"><CalendarDays size={13}/>{formatDate(event.event_date)}</span><span className="pill">{event.budget}</span>{event.gift_type&&<span className="pill"><Gift size={13}/>{event.gift_type}</span>}</div>
    <div className="my-5 flex items-center justify-center gap-2 text-xs text-gray-400"><span className={`size-1.5 rounded-full ${event.status==='drawn'?'bg-emerald-500':event.status==='draft'?'bg-amber-400':'bg-gray-400'}`}/>{event.status==='draft'?'Listo para organizar':event.status==='drawn'?'Sorteo realizado':'Evento archivado'}{owner&&<><span>·</span><span>Eres el organizador</span></>}</div>
    {error&&<p role="alert" className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{error}</p>}
    {owner&&<div className="space-y-3">
      {event.status!=='archived'&&<button className="btn-primary" onClick={()=>setConfirm(event.status==='drawn'?'redraw':'draw')} disabled={busy}><Shuffle size={18}/>{event.status==='drawn'?'Volver a sortear':'Generar sorteo'}</button>}
      <div className="grid grid-cols-2 gap-2"><button className="btn-secondary" disabled={busy||event.status==='archived'} onClick={()=>void showInvites()}><LinkIcon size={16}/>Invitaciones</button><button className="btn-secondary" disabled={busy||event.status==='archived'} onClick={()=>setEditing(true)}><Pencil size={15}/>Editar evento</button></div>
      <div className="pt-4"><div className="mb-3 flex items-center justify-between"><h2 className="flex items-center gap-2 text-sm font-bold"><Users size={16}/>Participantes <span className="text-gray-400">{people.length}</span></h2>{event.status==='draft'&&<button className="btn-text !min-h-8 !text-xs" onClick={()=>setAddOpen(true)}><Plus size={14}/>Agregar</button>}</div>
        <div className="space-y-2">{people.map(p=><div key={p.id} className="flex items-center justify-between rounded-xl border border-gray-100 px-3 py-3 dark:border-gray-900"><div className="flex min-w-0 items-center gap-3"><span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-gray-100 text-xs font-bold dark:bg-gray-900">{p.name.slice(0,1).toUpperCase()}</span><div className="min-w-0"><p className="truncate text-sm font-semibold">{p.name}</p><p className="text-[11px] text-gray-400">{p.is_child?`Dependiente · ${people.find(g=>g.id===p.guardian_id)?.name??'adulto responsable'}`:p.user_id===userId?'Tu perfil de organizador':'Acceso con NIP'}</p></div></div>{event.status==='draft'&&<button className="icon-button !size-8 hover:!text-red-500" aria-label={`Quitar a ${p.name}`} disabled={busy} onClick={()=>void action(async()=>{await rpc('remove_participant',{p_participant_id:p.id});await refresh()})}><X size={15}/></button>}</div>)}</div>
        {event.status==='drawn'&&<p className="mt-3 text-xs leading-relaxed text-gray-400">Los participantes quedan fijos después del sorteo para conservar sus resultados.</p>}
      </div>
    </div>}
    {mine.length>0&&<div className="mt-8 border-t border-gray-100 pt-6 dark:border-gray-900">
      {mine.length>1&&<><label htmlFor="profile" className="label !mt-0">Viendo perfil de</label><select id="profile" className="field mb-5" disabled={busy} value={profile?.id??''} onChange={e=>setActive(e.target.value)}>{mine.map(p=><option key={p.id} value={p.id}>{p.name}{p.is_child?' · Dependiente':''}</option>)}</select></>}
      <h2 className="mb-4 text-lg font-bold tracking-tight">Tu resultado{mine.length===1?<span className="float-right mt-1 text-xs font-medium text-gray-400">{profile?.name}</span>:null}</h2>
      {event.drawn_at?<div className="relative overflow-hidden rounded-2xl bg-gray-900 p-6 text-white">
        {!assignment?<button className="flex min-h-48 w-full flex-col items-center justify-center gap-4 rounded-xl focus-visible:!outline-white" disabled={busy} onClick={()=>void action(async()=>{const data=await rpc<Assignment>('get_my_assignment',{p_participant_id:profile.id});if(!data)throw new Error('El sorteo todavía no está listo.');setAssignment(data);if(!window.matchMedia('(prefers-reduced-motion: reduce)').matches) void confetti({particleCount:90,spread:65,origin:{y:.55}})})}><Gift size={45} strokeWidth={1.4}/><span className="text-xs font-bold tracking-widest">{busy?'CARGANDO…':'TOCA PARA REVELAR'}</span><span className="text-xs text-gray-400">Tu amigo secreto te espera</span></button>:<><p className="text-xs font-bold uppercase tracking-widest text-gray-400">Te tocó regalar a</p><h3 className="my-5 break-words text-4xl font-extrabold tracking-tight">{assignment.target_name}</h3><div className="mt-6 border-t border-white/15 pt-4"><p className="mb-3 text-xs font-semibold text-gray-400">Sus opciones:</p><ul className="space-y-3 text-sm">{assignment.wishes?.filter(Boolean).length?assignment.wishes.filter(Boolean).map((w,i)=><li key={i}><SafeText text={w}/></li>):<li className="italic text-gray-400">Sin opciones aún.</li>}</ul>{assignment.extra&&<p className="mt-4 border-t border-white/10 pt-4 text-sm"><SafeText text={assignment.extra}/></p>}</div><button className="mt-5 text-xs text-gray-400 underline" disabled={busy} onClick={()=>void action(async()=>setAssignment(await rpc<Assignment>('get_my_assignment',{p_participant_id:profile.id})))}>Actualizar preferencias</button></>}
      </div>:<div className="panel text-center"><Gift className="mx-auto mb-3 text-gray-400" size={28}/><p className="text-sm text-gray-500">El organizador aún no realiza el sorteo.</p><p className="mt-1 text-xs text-gray-400">Mientras tanto, completa tus preferencias.</p></div>}
      <form className="mt-7" key={profile?.id} onSubmit={e=>{e.preventDefault();void action(async()=>{await rpc('save_wishes',{p_participant_id:profile.id,p_wishes:wishes,p_extra:extra});setPeople(current=>current.map(p=>p.id===profile.id?{...p,wishes:[...wishes],extra}:p));onToast('Preferencias guardadas')})}}><h2 className="text-lg font-bold tracking-tight">Llena el perfil</h2><p className="mt-1 text-sm text-gray-500">Ayuda a tu amigo secreto.</p>{[0,1,2].map(i=><div key={i}><label className="label" htmlFor={`wish-${i}`}>Opción {i+1}</label><input id={`wish-${i}`} className="field" maxLength={500} placeholder={['Ej. Libro de terror','Ej. Taza de Batman','Ej. Calcetas (o un enlace)'][i]} value={wishes[i]} onChange={e=>setWishes(wishes.map((w,j)=>j===i?e.target.value:w))}/></div>)}<label className="label" htmlFor="extra">{event.gift_type?`${event.gift_type} · Información extra`:'Información extra'}</label><textarea id="extra" className="field min-h-24 resize-y" maxLength={1000} placeholder="Talla, color favorito o alguna pista…" value={extra} onChange={e=>setExtra(e.target.value)}/><button className="btn-primary mt-5" disabled={busy||event.status==='archived'}>{busy&&<LoaderCircle className="animate-spin" size={17}/>}Guardar preferencias</button></form>
    </div>}
    {owner&&<div className="mt-7 space-y-1 border-t border-gray-100 pt-4 dark:border-gray-900">
      <button className="btn-text mx-auto !text-xs" disabled={busy} onClick={()=>setConfirm('archive')}>{event.status==='archived'?<RotateCcw size={14}/>:<Archive size={14}/>} {event.status==='archived'?'Restaurar evento':'Archivar evento'}</button>
      <button className="btn-text mx-auto !text-xs !text-red-600 dark:!text-red-400" disabled={busy} onClick={()=>{setConfirmationWord('');setConfirm('delete')}}><Trash2 size={14}/>Eliminar definitivamente</button>
    </div>}
    {confirm&&<Modal title={confirm==='delete'?'¿Eliminar este evento?':confirm==='archive'?(event.status==='archived'?'¿Restaurar evento?':'¿Archivar evento?'):confirm==='redraw'?'¿Reasignar sorteo?':'¿Realizar el sorteo?'} onClose={()=>{if(!busy)setConfirm(null)}}>
      <p className="text-sm leading-relaxed text-gray-500">{confirm==='delete'?`Se borrará “${event.title}” junto con sus participantes, preferencias, NIP y sorteo. Sus invitaciones dejarán de funcionar. Esta acción no se puede deshacer.`:confirm==='archive'?(event.status==='archived'?'Volverá a aparecer entre tus eventos activos.':'El evento y sus datos se conservarán. Podrás restaurarlo desde tus eventos archivados.'):confirm==='redraw'?'Se reemplazarán todos los resultados anteriores. Avísales a tus invitados que deben volver a consultar su resultado.':'Cada persona recibirá un amigo secreto. Después no podrás agregar ni quitar participantes.'}</p>
      {confirm==='delete'&&<><label className="label" htmlFor="delete-event-confirmation">Escribe ELIMINAR para confirmar</label><input id="delete-event-confirmation" className="field" autoComplete="off" spellCheck={false} disabled={busy} value={confirmationWord} onChange={e=>setConfirmationWord(e.target.value)}/></>}
      {error&&<p role="alert" className="mt-4 text-sm text-red-600 dark:text-red-400">{error}</p>}
      <button className={confirm==='delete'?'btn-primary mt-6 !bg-red-600 !text-white hover:!bg-red-700':'btn-primary mt-6'} disabled={busy||(confirm==='delete'&&confirmationWord!=='ELIMINAR')} onClick={()=>void confirmAction()}>{busy&&<LoaderCircle size={16} className="animate-spin"/>}{confirm==='delete'?'Eliminar definitivamente':'Confirmar'}</button>
      <button className="btn-text mx-auto mt-2" disabled={busy} onClick={()=>setConfirm(null)}>Cancelar</button>
    </Modal>}
    {invitesOpen&&<Modal title={resettingInvite?'¿Restablecer su NIP?':'Invitaciones personales'} onClose={()=>{if(!busy){setInvitesOpen(false);setInvite(null);setResettingInvite(null)}}}>
      {error&&<p role="alert" className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{error}</p>}
      {resettingInvite?<>
        <p className="text-sm leading-relaxed text-gray-500">{resettingInvite.name} tendrá que crear un NIP nuevo desde su invitación. Se cerrarán sus sesiones de invitado y se conservarán sus preferencias y resultado.</p>
        <button className="btn-primary mt-6" disabled={busy} onClick={()=>void action(async()=>{
          const selected=resettingInvite
          await rpc('reset_pin',{p_participant_id:selected.participant_id})
          const updated={...selected,has_pin:false,claimed:false}
          setInvites(current=>current.map(item=>item.participant_id===selected.participant_id?updated:item))
          setInvite(updated)
          setResettingInvite(null)
          onToast('NIP restablecido. Ya puede crear uno nuevo.')
        })}>{busy&&<LoaderCircle size={16} className="animate-spin"/>}Restablecer NIP</button>
        <button className="btn-text mx-auto mt-2" disabled={busy} onClick={()=>setResettingInvite(null)}>Cancelar</button>
      </>:invite&&selectedInviteToken?<>
        <button className="btn-text -ml-3 mb-3" disabled={busy} onClick={()=>setInvite(null)}><ArrowLeft size={15}/>Ver participantes</button>
        <p className="text-center text-sm font-semibold">Invitación de {invite.name}</p>
        <div className="mx-auto my-5 w-fit rounded-xl bg-white p-3"><QRCodeSVG value={invitationUrl(selectedInviteToken)} size={176}/></div>
        <p className="mb-4 text-center text-xs leading-relaxed text-gray-500">Compártela sólo con {invite.name}. Al abrirla podrá crear su NIP de seis dígitos y entrar sin una cuenta.</p>
        <div className="panel mb-4 break-all select-all text-xs">{invitationUrl(selectedInviteToken)}</div>
        <button className="btn-primary" disabled={busy} onClick={()=>void share(invitationUrl(selectedInviteToken),invite.name)}><Share2 size={17}/>Compartir invitación</button>
        <button className="btn-text mx-auto mt-2" disabled={busy} onClick={()=>void copy(invitationUrl(selectedInviteToken))}><Copy size={15}/>Copiar enlace</button>
        {invite.has_pin&&<button className="btn-secondary mt-4" disabled={busy} onClick={()=>setResettingInvite(invite)}><KeyRound size={16}/>Restablecer NIP</button>}
      </>:<>
        <p className="mb-4 text-sm leading-relaxed text-gray-500">Cada adulto entra con su enlace y NIP, sin crear una cuenta. Sus dependientes usarán el mismo acceso.</p>
        {mine.length===0&&<p className="mb-4 rounded-xl bg-gray-50 p-3 text-xs leading-relaxed text-gray-500 dark:bg-gray-900">Si también participas, abre tu propia invitación y crea tu NIP.</p>}
        <div className="space-y-2">{invites.map(item=><button key={item.participant_id} disabled={!item.token||busy} className="flex w-full items-center justify-between gap-2 rounded-xl border border-gray-200 p-3 text-left dark:border-gray-800" onClick={()=>{if(item.token)setInvite(item)}}><span className="truncate text-sm font-semibold">{item.name}</span><span className="flex shrink-0 items-center gap-2 text-xs text-gray-400">{item.has_pin?<><CheckCircle2 size={14}/>NIP creado</>:'Compartir'}<ChevronRight size={15}/></span></button>)}</div>
      </>}
    </Modal>}
    {addOpen&&<Modal title="Agregar participante" onClose={()=>setAddOpen(false)}><form onSubmit={e=>{e.preventDefault();void action(async()=>{await rpc('add_participant',{p_event_id:id,p_name:newName.trim(),p_is_child:newChild,p_guardian_id:newChild?guardian:null});setAddOpen(false);setNewName('');setNewChild(false);setGuardian('');await refresh()})}}><label htmlFor="new-name" className="label !mt-0">Nombre</label><input id="new-name" className="field" required maxLength={80} value={newName} onChange={e=>setNewName(e.target.value)}/><label className="mt-3 flex gap-2 text-sm"><input type="checkbox" checked={newChild} onChange={e=>setNewChild(e.target.checked)}/>Dependiente</label>{newChild&&<select className="field mt-3" aria-label="Adulto responsable" required value={guardian} onChange={e=>setGuardian(e.target.value)}><option value="">Selecciona un adulto</option>{people.filter(p=>!p.is_child).map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select>}{error&&<p className="mt-3 text-sm text-red-600" role="alert">{error}</p>}<button className="btn-primary mt-5" disabled={busy}>Agregar</button></form></Modal>}
  </section>
}
function SafeText({text}:{text:string}) {return <span className="break-words">{text.split(/(https?:\/\/[^\s]+)/g).map((part,i)=>/^https?:\/\//i.test(part)?<a key={i} href={part} className="underline underline-offset-2" target="_blank" rel="noopener noreferrer">{part}</a>:part)}</span>}
