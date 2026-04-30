-- Seed a baseline set of global (cross-project) risk policies.
--
-- Goal: these policies should be broadly appropriate for *any* CAF deployment.
-- They are intentionally conservative: most route to manual review, while the
-- highest-risk categories (self-harm, minors sexual content, weapon/explosives
-- instructions, PII leaks) are marked CRITICAL and block publish.
--
-- Notes:
-- - detection_terms are semicolon-separated and matched by qc-runtime keyword scan
--   against JSON.stringify(generated_output).toLowerCase().
-- - single words use word-boundary matching; phrases (contain whitespace) use
--   substring matching.
-- - `applies_to_flow_type` is NULL to apply to all flows (global baseline).

BEGIN;

-- 1) Profanity / swear words (review, usually not a hard block)
INSERT INTO caf_core.risk_policies (
  risk_policy_name, risk_policy_version, risk_category,
  detection_method, detection_terms,
  severity_level, default_action, requires_manual_review, requires_senior_review,
  block_publish, disclaimer_template_name, notes,
  applies_to_flow_type
) VALUES (
  'profanity_swear_words', '1', 'profanity',
  'keyword',
  'fuck;fucking;f*ck;shit;shitty;bitch;bastard;asshole;motherfucker;cunt;dick;cock;pussy;slut;whore;wanker;twat;bullshit',
  'MEDIUM', 'route_to_manual', true, false,
  false, NULL,
  'Baseline profanity scan. Conservative routing to manual review; not an auto-block.',
  NULL
)
ON CONFLICT (risk_policy_name, risk_policy_version) DO UPDATE SET
  risk_category = EXCLUDED.risk_category,
  detection_method = EXCLUDED.detection_method,
  detection_terms = EXCLUDED.detection_terms,
  severity_level = EXCLUDED.severity_level,
  default_action = EXCLUDED.default_action,
  requires_manual_review = EXCLUDED.requires_manual_review,
  requires_senior_review = EXCLUDED.requires_senior_review,
  block_publish = EXCLUDED.block_publish,
  disclaimer_template_name = EXCLUDED.disclaimer_template_name,
  notes = EXCLUDED.notes,
  applies_to_flow_type = EXCLUDED.applies_to_flow_type;

-- 2) Hate / slurs / harassment (manual review; many deployments will tighten terms)
INSERT INTO caf_core.risk_policies (
  risk_policy_name, risk_policy_version, risk_category,
  detection_method, detection_terms,
  severity_level, default_action, requires_manual_review, requires_senior_review,
  block_publish, disclaimer_template_name, notes,
  applies_to_flow_type
) VALUES (
  'hate_or_harassment', '1', 'hate_harassment',
  'keyword',
  'racial slur;kill yourself;go die;subhuman;vermin;degenerate;nazi;white supremacy;heil hitler',
  'HIGH', 'route_to_manual', true, true,
  false, NULL,
  'Baseline hate/harassment phrases. Routes to senior/manual review; deployments may expand the term list.',
  NULL
)
ON CONFLICT (risk_policy_name, risk_policy_version) DO UPDATE SET
  risk_category = EXCLUDED.risk_category,
  detection_method = EXCLUDED.detection_method,
  detection_terms = EXCLUDED.detection_terms,
  severity_level = EXCLUDED.severity_level,
  default_action = EXCLUDED.default_action,
  requires_manual_review = EXCLUDED.requires_manual_review,
  requires_senior_review = EXCLUDED.requires_senior_review,
  block_publish = EXCLUDED.block_publish,
  disclaimer_template_name = EXCLUDED.disclaimer_template_name,
  notes = EXCLUDED.notes,
  applies_to_flow_type = EXCLUDED.applies_to_flow_type;

-- 3) Self-harm / suicide (hard block)
INSERT INTO caf_core.risk_policies (
  risk_policy_name, risk_policy_version, risk_category,
  detection_method, detection_terms,
  severity_level, default_action, requires_manual_review, requires_senior_review,
  block_publish, disclaimer_template_name, notes,
  applies_to_flow_type
) VALUES (
  'self_harm_or_suicide', '1', 'self_harm',
  'keyword',
  'suicide;kill myself;self harm;self-harm;cut myself;overdose;how to die',
  'CRITICAL', 'block', true, true,
  true, NULL,
  'Self-harm / suicide intent or instructions. Marked CRITICAL + block_publish.',
  NULL
)
ON CONFLICT (risk_policy_name, risk_policy_version) DO UPDATE SET
  risk_category = EXCLUDED.risk_category,
  detection_method = EXCLUDED.detection_method,
  detection_terms = EXCLUDED.detection_terms,
  severity_level = EXCLUDED.severity_level,
  default_action = EXCLUDED.default_action,
  requires_manual_review = EXCLUDED.requires_manual_review,
  requires_senior_review = EXCLUDED.requires_senior_review,
  block_publish = EXCLUDED.block_publish,
  disclaimer_template_name = EXCLUDED.disclaimer_template_name,
  notes = EXCLUDED.notes,
  applies_to_flow_type = EXCLUDED.applies_to_flow_type;

-- 4) Violence / threats (manual review)
INSERT INTO caf_core.risk_policies (
  risk_policy_name, risk_policy_version, risk_category,
  detection_method, detection_terms,
  severity_level, default_action, requires_manual_review, requires_senior_review,
  block_publish, disclaimer_template_name, notes,
  applies_to_flow_type
) VALUES (
  'violence_or_threats', '1', 'violence',
  'keyword',
  'kill them;shoot them;stab them;beat them up;i will kill;threaten;massacre;execute;decapitate',
  'HIGH', 'route_to_manual', true, true,
  false, NULL,
  'Violence / threats language. Routes to senior/manual review.',
  NULL
)
ON CONFLICT (risk_policy_name, risk_policy_version) DO UPDATE SET
  risk_category = EXCLUDED.risk_category,
  detection_method = EXCLUDED.detection_method,
  detection_terms = EXCLUDED.detection_terms,
  severity_level = EXCLUDED.severity_level,
  default_action = EXCLUDED.default_action,
  requires_manual_review = EXCLUDED.requires_manual_review,
  requires_senior_review = EXCLUDED.requires_senior_review,
  block_publish = EXCLUDED.block_publish,
  disclaimer_template_name = EXCLUDED.disclaimer_template_name,
  notes = EXCLUDED.notes,
  applies_to_flow_type = EXCLUDED.applies_to_flow_type;

-- 5) Weapons / explosives instructions (hard block)
INSERT INTO caf_core.risk_policies (
  risk_policy_name, risk_policy_version, risk_category,
  detection_method, detection_terms,
  severity_level, default_action, requires_manual_review, requires_senior_review,
  block_publish, disclaimer_template_name, notes,
  applies_to_flow_type
) VALUES (
  'weapons_or_explosives_instructions', '1', 'weapons_explosives',
  'keyword',
  'how to make a bomb;make a bomb;homemade bomb;explosive;pipe bomb;molotov;detonator;silencer;ghost gun;how to build a gun',
  'CRITICAL', 'block', true, true,
  true, NULL,
  'Weapon/explosive construction or instruction phrases. Marked CRITICAL + block_publish.',
  NULL
)
ON CONFLICT (risk_policy_name, risk_policy_version) DO UPDATE SET
  risk_category = EXCLUDED.risk_category,
  detection_method = EXCLUDED.detection_method,
  detection_terms = EXCLUDED.detection_terms,
  severity_level = EXCLUDED.severity_level,
  default_action = EXCLUDED.default_action,
  requires_manual_review = EXCLUDED.requires_manual_review,
  requires_senior_review = EXCLUDED.requires_senior_review,
  block_publish = EXCLUDED.block_publish,
  disclaimer_template_name = EXCLUDED.disclaimer_template_name,
  notes = EXCLUDED.notes,
  applies_to_flow_type = EXCLUDED.applies_to_flow_type;

-- 6) Illegal drugs / illicit substances (manual review)
INSERT INTO caf_core.risk_policies (
  risk_policy_name, risk_policy_version, risk_category,
  detection_method, detection_terms,
  severity_level, default_action, requires_manual_review, requires_senior_review,
  block_publish, disclaimer_template_name, notes,
  applies_to_flow_type
) VALUES (
  'illegal_drugs', '1', 'illicit_drugs',
  'keyword',
  'cocaine;meth;crystal meth;heroin;fentanyl;lsd;ecstasy;mdma;ketamine;how to buy drugs;deal drugs;drug dealer',
  'HIGH', 'route_to_manual', true, false,
  false, NULL,
  'Illicit drug references. Routes to manual review; not a hard block by default.',
  NULL
)
ON CONFLICT (risk_policy_name, risk_policy_version) DO UPDATE SET
  risk_category = EXCLUDED.risk_category,
  detection_method = EXCLUDED.detection_method,
  detection_terms = EXCLUDED.detection_terms,
  severity_level = EXCLUDED.severity_level,
  default_action = EXCLUDED.default_action,
  requires_manual_review = EXCLUDED.requires_manual_review,
  requires_senior_review = EXCLUDED.requires_senior_review,
  block_publish = EXCLUDED.block_publish,
  disclaimer_template_name = EXCLUDED.disclaimer_template_name,
  notes = EXCLUDED.notes,
  applies_to_flow_type = EXCLUDED.applies_to_flow_type;

-- 7) Sexual content (adult) (manual review)
INSERT INTO caf_core.risk_policies (
  risk_policy_name, risk_policy_version, risk_category,
  detection_method, detection_terms,
  severity_level, default_action, requires_manual_review, requires_senior_review,
  block_publish, disclaimer_template_name, notes,
  applies_to_flow_type
) VALUES (
  'sexual_content_adult', '1', 'sexual_content',
  'keyword',
  'porn;pornography;sex scene;explicit;erotic;nudes;naked photos;onlyfans;hardcore;blowjob;anal sex',
  'HIGH', 'route_to_manual', true, true,
  false, NULL,
  'Explicit sexual content (adult). Routes to senior/manual review.',
  NULL
)
ON CONFLICT (risk_policy_name, risk_policy_version) DO UPDATE SET
  risk_category = EXCLUDED.risk_category,
  detection_method = EXCLUDED.detection_method,
  detection_terms = EXCLUDED.detection_terms,
  severity_level = EXCLUDED.severity_level,
  default_action = EXCLUDED.default_action,
  requires_manual_review = EXCLUDED.requires_manual_review,
  requires_senior_review = EXCLUDED.requires_senior_review,
  block_publish = EXCLUDED.block_publish,
  disclaimer_template_name = EXCLUDED.disclaimer_template_name,
  notes = EXCLUDED.notes,
  applies_to_flow_type = EXCLUDED.applies_to_flow_type;

-- 8) Sexual content involving minors (hard block)
INSERT INTO caf_core.risk_policies (
  risk_policy_name, risk_policy_version, risk_category,
  detection_method, detection_terms,
  severity_level, default_action, requires_manual_review, requires_senior_review,
  block_publish, disclaimer_template_name, notes,
  applies_to_flow_type
) VALUES (
  'sexual_content_minors', '1', 'sexual_content_minors',
  'keyword',
  'child porn;underage;minor sex;teen porn;sexual with a minor',
  'CRITICAL', 'block', true, true,
  true, NULL,
  'Any explicit sexual content involving minors. Marked CRITICAL + block_publish.',
  NULL
)
ON CONFLICT (risk_policy_name, risk_policy_version) DO UPDATE SET
  risk_category = EXCLUDED.risk_category,
  detection_method = EXCLUDED.detection_method,
  detection_terms = EXCLUDED.detection_terms,
  severity_level = EXCLUDED.severity_level,
  default_action = EXCLUDED.default_action,
  requires_manual_review = EXCLUDED.requires_manual_review,
  requires_senior_review = EXCLUDED.requires_senior_review,
  block_publish = EXCLUDED.block_publish,
  disclaimer_template_name = EXCLUDED.disclaimer_template_name,
  notes = EXCLUDED.notes,
  applies_to_flow_type = EXCLUDED.applies_to_flow_type;

-- 9) Dangerous instructions (poisoning / harm) (hard block)
INSERT INTO caf_core.risk_policies (
  risk_policy_name, risk_policy_version, risk_category,
  detection_method, detection_terms,
  severity_level, default_action, requires_manual_review, requires_senior_review,
  block_publish, disclaimer_template_name, notes,
  applies_to_flow_type
) VALUES (
  'dangerous_instructions', '1', 'dangerous_instructions',
  'keyword',
  'drink bleach;bleach cure;poison yourself;how to poison;how to hurt someone;how to kill someone;how to make poison;carbon monoxide poisoning',
  'CRITICAL', 'block', true, true,
  true, NULL,
  'Explicit dangerous instruction phrases. Marked CRITICAL + block_publish.',
  NULL
)
ON CONFLICT (risk_policy_name, risk_policy_version) DO UPDATE SET
  risk_category = EXCLUDED.risk_category,
  detection_method = EXCLUDED.detection_method,
  detection_terms = EXCLUDED.detection_terms,
  severity_level = EXCLUDED.severity_level,
  default_action = EXCLUDED.default_action,
  requires_manual_review = EXCLUDED.requires_manual_review,
  requires_senior_review = EXCLUDED.requires_senior_review,
  block_publish = EXCLUDED.block_publish,
  disclaimer_template_name = EXCLUDED.disclaimer_template_name,
  notes = EXCLUDED.notes,
  applies_to_flow_type = EXCLUDED.applies_to_flow_type;

-- 10) Medical diagnosis / treatment advice & strong health claims (manual review)
INSERT INTO caf_core.risk_policies (
  risk_policy_name, risk_policy_version, risk_category,
  detection_method, detection_terms,
  severity_level, default_action, requires_manual_review, requires_senior_review,
  block_publish, disclaimer_template_name, notes,
  applies_to_flow_type
) VALUES (
  'medical_advice_or_claims', '1', 'medical_health_claims',
  'keyword',
  'diagnose;diagnosis;treats;cures;miracle cure;guaranteed cure;prescription;dosage;side effects;medical advice;doctor said;clinical proof;heals;medicine',
  'HIGH', 'route_to_manual', true, true,
  false, NULL,
  'Medical diagnosis/treatment advice and strong health claims. Routes to senior/manual review; not a hard block by default.',
  NULL
)
ON CONFLICT (risk_policy_name, risk_policy_version) DO UPDATE SET
  risk_category = EXCLUDED.risk_category,
  detection_method = EXCLUDED.detection_method,
  detection_terms = EXCLUDED.detection_terms,
  severity_level = EXCLUDED.severity_level,
  default_action = EXCLUDED.default_action,
  requires_manual_review = EXCLUDED.requires_manual_review,
  requires_senior_review = EXCLUDED.requires_senior_review,
  block_publish = EXCLUDED.block_publish,
  disclaimer_template_name = EXCLUDED.disclaimer_template_name,
  notes = EXCLUDED.notes,
  applies_to_flow_type = EXCLUDED.applies_to_flow_type;

-- 11) Financial advice / investment signals (manual review)
INSERT INTO caf_core.risk_policies (
  risk_policy_name, risk_policy_version, risk_category,
  detection_method, detection_terms,
  severity_level, default_action, requires_manual_review, requires_senior_review,
  block_publish, disclaimer_template_name, notes,
  applies_to_flow_type
) VALUES (
  'financial_advice_or_investing', '1', 'financial_advice',
  'keyword',
  'not financial advice;financial advice;investment advice;buy now;sell now;guaranteed returns;double your money;get rich quick;stock tip;crypto signal;options trading;forex signal',
  'HIGH', 'route_to_manual', true, true,
  false, NULL,
  'Financial advice / investment signaling. Routes to senior/manual review by default.',
  NULL
)
ON CONFLICT (risk_policy_name, risk_policy_version) DO UPDATE SET
  risk_category = EXCLUDED.risk_category,
  detection_method = EXCLUDED.detection_method,
  detection_terms = EXCLUDED.detection_terms,
  severity_level = EXCLUDED.severity_level,
  default_action = EXCLUDED.default_action,
  requires_manual_review = EXCLUDED.requires_manual_review,
  requires_senior_review = EXCLUDED.requires_senior_review,
  block_publish = EXCLUDED.block_publish,
  disclaimer_template_name = EXCLUDED.disclaimer_template_name,
  notes = EXCLUDED.notes,
  applies_to_flow_type = EXCLUDED.applies_to_flow_type;

-- 12) Legal advice (manual review)
INSERT INTO caf_core.risk_policies (
  risk_policy_name, risk_policy_version, risk_category,
  detection_method, detection_terms,
  severity_level, default_action, requires_manual_review, requires_senior_review,
  block_publish, disclaimer_template_name, notes,
  applies_to_flow_type
) VALUES (
  'legal_advice', '1', 'legal_advice',
  'keyword',
  'legal advice;i am a lawyer;lawsuit;suing;contract law;liability;criminal charges;defamation;terms and conditions',
  'MEDIUM', 'route_to_manual', true, false,
  false, NULL,
  'Legal advice / legal claims. Routes to manual review; many projects will allow with disclaimers.',
  NULL
)
ON CONFLICT (risk_policy_name, risk_policy_version) DO UPDATE SET
  risk_category = EXCLUDED.risk_category,
  detection_method = EXCLUDED.detection_method,
  detection_terms = EXCLUDED.detection_terms,
  severity_level = EXCLUDED.severity_level,
  default_action = EXCLUDED.default_action,
  requires_manual_review = EXCLUDED.requires_manual_review,
  requires_senior_review = EXCLUDED.requires_senior_review,
  block_publish = EXCLUDED.block_publish,
  disclaimer_template_name = EXCLUDED.disclaimer_template_name,
  notes = EXCLUDED.notes,
  applies_to_flow_type = EXCLUDED.applies_to_flow_type;

-- 13) PII / credential leaks (hard block)
INSERT INTO caf_core.risk_policies (
  risk_policy_name, risk_policy_version, risk_category,
  detection_method, detection_terms,
  severity_level, default_action, requires_manual_review, requires_senior_review,
  block_publish, disclaimer_template_name, notes,
  applies_to_flow_type
) VALUES (
  'pii_or_credentials', '1', 'pii_credentials',
  'keyword',
  'social security number;ssn;credit card;card number;cvv;bank account number;routing number;password;passcode;api key;secret key;private key;seed phrase;mnemonic phrase',
  'CRITICAL', 'block', true, true,
  true, NULL,
  'PII or credential leakage indicators. Marked CRITICAL + block_publish.',
  NULL
)
ON CONFLICT (risk_policy_name, risk_policy_version) DO UPDATE SET
  risk_category = EXCLUDED.risk_category,
  detection_method = EXCLUDED.detection_method,
  detection_terms = EXCLUDED.detection_terms,
  severity_level = EXCLUDED.severity_level,
  default_action = EXCLUDED.default_action,
  requires_manual_review = EXCLUDED.requires_manual_review,
  requires_senior_review = EXCLUDED.requires_senior_review,
  block_publish = EXCLUDED.block_publish,
  disclaimer_template_name = EXCLUDED.disclaimer_template_name,
  notes = EXCLUDED.notes,
  applies_to_flow_type = EXCLUDED.applies_to_flow_type;

-- 14) Scams / fraud / money transfer coercion (hard block)
INSERT INTO caf_core.risk_policies (
  risk_policy_name, risk_policy_version, risk_category,
  detection_method, detection_terms,
  severity_level, default_action, requires_manual_review, requires_senior_review,
  block_publish, disclaimer_template_name, notes,
  applies_to_flow_type
) VALUES (
  'scams_or_fraud', '1', 'scams_fraud',
  'keyword',
  'wire transfer;send money;gift card;bitcoin wallet;crypto wallet;pay me;urgent payment;limited time offer;act now or else;account suspended;verify your account;refund scam',
  'CRITICAL', 'block', true, true,
  true, NULL,
  'Classic scam/fraud terms (payment coercion / credential capture). Marked CRITICAL + block_publish.',
  NULL
)
ON CONFLICT (risk_policy_name, risk_policy_version) DO UPDATE SET
  risk_category = EXCLUDED.risk_category,
  detection_method = EXCLUDED.detection_method,
  detection_terms = EXCLUDED.detection_terms,
  severity_level = EXCLUDED.severity_level,
  default_action = EXCLUDED.default_action,
  requires_manual_review = EXCLUDED.requires_manual_review,
  requires_senior_review = EXCLUDED.requires_senior_review,
  block_publish = EXCLUDED.block_publish,
  disclaimer_template_name = EXCLUDED.disclaimer_template_name,
  notes = EXCLUDED.notes,
  applies_to_flow_type = EXCLUDED.applies_to_flow_type;

COMMIT;

