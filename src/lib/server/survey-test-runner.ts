import type pg from "pg";
import {randomUUID} from "node:crypto";
import {createNeonSurveyDelivery} from "./neon-survey-delivery.ts";
import {createSurveyDispatcher} from "./survey-dispatcher.ts";
/** No Graph import, no HTTP, no configurable destination. Only the repository's
 * leading-zero fixtures can be claimed. Never marks enviada_en. */
export function dispatchSyntheticSurveys(pool:pg.Pool){
  return createSurveyDispatcher(createNeonSurveyDelivery(pool),{
    mode:"FAKE_ONLY",
    async send(){return {status:"ACCEPTED",messageId:"synthetic-ack-"+randomUUID()};}
  },{template:"synthetic_survey_test",language:"es_MX"}).run(50);
}
