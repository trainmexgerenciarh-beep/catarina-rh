import type {RequestHandler} from "@sveltejs/kit";
import {createCronHandler} from "../../../lib/server/cron-handler";
import {getNeonPool} from "../../../lib/server/neon-collaborators";
import {prepareSurveys} from "../../../lib/server/rh-service";
export const POST:RequestHandler=createCronHandler({prepare:()=>prepareSurveys(getNeonPool())});
