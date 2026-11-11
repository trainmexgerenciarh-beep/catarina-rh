import type {RequestHandler} from "@sveltejs/kit";
import {createCronHandler} from "../../../lib/server/cron-handler";
import {getNeonPool} from "../../../lib/server/neon-collaborators";
import {prepareSurveys} from "../../../lib/server/rh-service";
import {dispatchSyntheticSurveys} from "../../../lib/server/survey-test-runner";
export const POST:RequestHandler=createCronHandler({
  prepare:()=>prepareSurveys(getNeonPool()),
  dispatchTest:()=>dispatchSyntheticSurveys(getNeonPool())
});
