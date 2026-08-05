import { Skeleton } from "@/components/ui";

export default function InternalLoading() {
  return <div className="space-y-7" role="status" aria-label="Chargement de la page">
    <div><Skeleton className="h-3 w-24 rounded-full"/><Skeleton className="mt-3 h-9 w-60 max-w-full rounded-xl"/><Skeleton className="mt-3 h-4 w-[420px] max-w-full rounded-lg"/></div>
    <Skeleton className="h-52 w-full rounded-[26px]"/>
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{Array.from({length:4},(_,index)=><Skeleton key={index} className="h-36 rounded-[20px]"/>)}</div>
    <div className="grid gap-6 lg:grid-cols-2"><Skeleton className="h-72 rounded-[20px]"/><Skeleton className="h-72 rounded-[20px]"/></div>
    <span className="sr-only">Chargement…</span>
  </div>;
}
