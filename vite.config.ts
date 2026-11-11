import adapter from "@sveltejs/adapter-node";
import { sveltekit } from "@sveltejs/kit/vite";
import { createLogger, defineConfig } from "vite";

const viteLogger = createLogger();
const customLogger: typeof viteLogger = {
  info(message, options) {
    viteLogger.info(redactWebhookQuery(message), options);
  },
  warn(message, options) {
    viteLogger.warn(redactWebhookQuery(message), options);
  },
  warnOnce(message, options) {
    viteLogger.warnOnce(redactWebhookQuery(message), options);
  },
  error(message, options) {
    viteLogger.error(redactWebhookQuery(message), options);
  },
  clearScreen(type) {
    viteLogger.clearScreen(type);
  },
  hasErrorLogged(error) {
    return viteLogger.hasErrorLogged(error);
  },
  get hasWarned() {
    return viteLogger.hasWarned;
  }
};

function redactWebhookQuery(message: string): string {
  return message.replace(
    /([?&](?:hub\.verify_token|hub\.challenge|token|secret|password|key)=)[^&\s]+/gi,
    "$1[redacted]"
  );
}

export default defineConfig({
  plugins: [
    sveltekit({
      adapter: adapter()
    })
  ],
  customLogger,
  server: {
    allowedHosts: true
  }
});
