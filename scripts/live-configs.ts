// The provider settings the live scripts use: a current model at low effort for each CLI (provider-login), and an
// inexpensive Gateway model (its API key route). Shared by live-acceptance.ts and upkeep.ts.
import type {Provider,ProviderConfig} from '../src/types.js';

export const LIVE_CONFIGS:Record<Provider,ProviderConfig>={
  codex:{provider:'codex',model:'gpt-6-astra',effort:{key:'reasoning_effort',value:'low'},auth:'provider-login'},
  claude:{provider:'claude',model:'default',effort:{key:'effort',value:'low'},auth:'provider-login'},
  'grok-build':{provider:'grok-build',model:'grok-4.7',auth:'provider-login'},
  antigravity:{provider:'antigravity',model:'gemini-3.7-flash-high',auth:'provider-login'},
  vercel:{provider:'vercel',model:'openai/gpt-5.6-luna',effort:{key:'model_reasoning_effort',value:'low'},auth:'api'},
};
