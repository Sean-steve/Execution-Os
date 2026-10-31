import { DEFAULT_APP_STATE } from '../data/defaultData';
import { LEGACY_STANDALONE_FIXTURE_STATE } from './fixtures/legacyStandaloneProfile';

const fixture = JSON.parse(JSON.stringify(LEGACY_STANDALONE_FIXTURE_STATE));
for (const key of Object.keys(DEFAULT_APP_STATE as any)) {
  delete (DEFAULT_APP_STATE as any)[key];
}
Object.assign(DEFAULT_APP_STATE as any, fixture);

(DEFAULT_APP_STATE as any).legacyStandaloneCompatibility = true;
