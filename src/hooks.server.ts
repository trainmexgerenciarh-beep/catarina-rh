import type {Handle} from "@sveltejs/kit/hooks";
import {startMaintenance} from "./lib/server/maintenance";
import {getNeonPool} from "./lib/server/neon-collaborators";
let maintenance:ReturnType<typeof startMaintenance>|undefined;
export const handle:Handle=async({event,resolve})=>{
  // Timers do not execute during static build, and do not send WhatsApp.
  if(!maintenance&&process.env.DATABASE_URL)maintenance=startMaintenance(getNeonPool(),{
    onError:()=>console.error("[maintenance] Preparation unavailable; outbound remains disabled")
  });
  const response=await resolve(event);
  if(event.url.pathname.startsWith("/api/")||["/panel","/readyz","/healthz"].includes(event.url.pathname)){
    response.headers.set("cache-control","no-store");
    response.headers.set("x-content-type-options","nosniff");
    response.headers.set("referrer-policy","same-origin");
  }
  return response;
};
(import.meta as ImportMeta&{hot?:{dispose(fn:()=>void):void}}).hot?.dispose(()=>maintenance?.dispose());
