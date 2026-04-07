#!/usr/bin/env node
/**
 * Import Project Config from XLSX into CAF Core PostgreSQL.
 * Usage: node scripts/import-project-config.js <path-to-xlsx> [project-slug]
 */
const XLSX = require("xlsx");
const { Pool } = require("pg");

const XLSX_PATH = process.argv[2] || "C:\\Users\\migue\\Downloads\\CREATION - Project Config Sheet (4).xlsx";
const PROJECT_SLUG = process.argv[3] || "SNS";

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  const wb = XLSX.readFile(XLSX_PATH);
  const sheet = (name) => XLSX.utils.sheet_to_json(wb.Sheets[name] || {}, { defval: "" });

  // Ensure project exists
  let project = (await pool.query(
    `SELECT id FROM caf_core.projects WHERE slug = $1`, [PROJECT_SLUG]
  )).rows[0];
  if (!project) {
    project = (await pool.query(
      `INSERT INTO caf_core.projects (slug, display_name) VALUES ($1, $2) RETURNING id`,
      [PROJECT_SLUG, "Demo " + PROJECT_SLUG]
    )).rows[0];
    console.log("Created project:", PROJECT_SLUG, project.id);
  } else {
    console.log("Using existing project:", PROJECT_SLUG, project.id);
  }
  const pid = project.id;

  // --- Strategy Defaults ---
  const stratRows = sheet("Strategy Defaults");
  if (stratRows.length > 0) {
    const s = stratRows[0];
    await pool.query(`
      INSERT INTO caf_core.strategy_defaults (
        project_id, project_type, core_offer, target_audience, audience_problem,
        transformation_promise, positioning_statement, primary_business_goal, primary_content_goal,
        north_star_metric, monetization_model, traffic_destination, funnel_stage_focus,
        brand_archetype, strategic_content_pillars, authority_angle, differentiation_angle,
        growth_strategy, publishing_intensity, time_horizon, owner, notes
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
      ON CONFLICT (project_id) DO UPDATE SET
        project_type=EXCLUDED.project_type, core_offer=EXCLUDED.core_offer,
        target_audience=EXCLUDED.target_audience, audience_problem=EXCLUDED.audience_problem,
        transformation_promise=EXCLUDED.transformation_promise, positioning_statement=EXCLUDED.positioning_statement,
        primary_business_goal=EXCLUDED.primary_business_goal, primary_content_goal=EXCLUDED.primary_content_goal,
        north_star_metric=EXCLUDED.north_star_metric, monetization_model=EXCLUDED.monetization_model,
        traffic_destination=EXCLUDED.traffic_destination, funnel_stage_focus=EXCLUDED.funnel_stage_focus,
        brand_archetype=EXCLUDED.brand_archetype, strategic_content_pillars=EXCLUDED.strategic_content_pillars,
        authority_angle=EXCLUDED.authority_angle, differentiation_angle=EXCLUDED.differentiation_angle,
        growth_strategy=EXCLUDED.growth_strategy, publishing_intensity=EXCLUDED.publishing_intensity,
        time_horizon=EXCLUDED.time_horizon, owner=EXCLUDED.owner, notes=EXCLUDED.notes, updated_at=now()
    `, [
      pid, s.project_type, s.core_offer, s.target_audience, s.audience_problem,
      s.transformation_promise, s.positioning_statement, s.primary_business_goal, s.primary_content_goal,
      s.north_star_metric, s.monetization_model, s.traffic_destination, s.funnel_stage_focus,
      s.brand_archetype, s.strategic_content_pillars, s.authority_angle, s.differentiation_angle,
      s.growth_strategy, s.publishing_intensity, s.time_horizon, s.owner, s.notes
    ]);
    console.log("Strategy defaults: upserted");
  }

  // --- Brand Constraints ---
  const brandRows = sheet("Brand Constraints");
  if (brandRows.length > 0) {
    const b = brandRows[0];
    await pool.query(`
      INSERT INTO caf_core.brand_constraints (
        project_id, tone, voice_style, audience_level, emotional_intensity, humor_level,
        emoji_policy, max_emojis_per_caption, banned_claims, banned_words, mandatory_disclaimers,
        cta_style_rules, storytelling_style, positioning_statement, differentiation_angle,
        risk_level_default, manual_review_required, notes
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
      ON CONFLICT (project_id) DO UPDATE SET
        tone=EXCLUDED.tone, voice_style=EXCLUDED.voice_style, audience_level=EXCLUDED.audience_level,
        emotional_intensity=EXCLUDED.emotional_intensity, humor_level=EXCLUDED.humor_level,
        emoji_policy=EXCLUDED.emoji_policy, max_emojis_per_caption=EXCLUDED.max_emojis_per_caption,
        banned_claims=EXCLUDED.banned_claims, banned_words=EXCLUDED.banned_words,
        mandatory_disclaimers=EXCLUDED.mandatory_disclaimers, cta_style_rules=EXCLUDED.cta_style_rules,
        storytelling_style=EXCLUDED.storytelling_style, positioning_statement=EXCLUDED.positioning_statement,
        differentiation_angle=EXCLUDED.differentiation_angle, risk_level_default=EXCLUDED.risk_level_default,
        manual_review_required=EXCLUDED.manual_review_required, notes=EXCLUDED.notes, updated_at=now()
    `, [
      pid, b.tone, b.voice_style, b.audience_level,
      b.emotional_intensity || null, b.humor_level || null,
      b.emoji_policy, b.max_emojis_per_caption || null,
      b.banned_claims, b.banned_words, b.mandatory_disclaimers,
      b.cta_style_rules, b.storytelling_style, b.positioning_statement,
      b.differentiation_angle, b.risk_level_default,
      b.manual_review_required === true || b.manual_review_required === "TRUE",
      b.notes
    ]);
    console.log("Brand constraints: upserted");
  }

  // --- Platform Constraints ---
  const platRows = sheet("Platform Constraints");
  for (const p of platRows) {
    if (!p.platform) continue;
    await pool.query(`
      INSERT INTO caf_core.platform_constraints (
        project_id, platform, caption_max_chars, hook_must_fit_first_lines, hook_max_chars,
        slide_min_chars, slide_max_chars, slide_min, slide_max, max_hashtags, hashtag_format_rule,
        line_break_policy, emoji_allowed, link_allowed, tag_allowed, formatting_rules,
        posting_frequency_limit, best_posting_window, notes
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
      ON CONFLICT (project_id, platform) DO UPDATE SET
        caption_max_chars=EXCLUDED.caption_max_chars, hook_must_fit_first_lines=EXCLUDED.hook_must_fit_first_lines,
        hook_max_chars=EXCLUDED.hook_max_chars, slide_min_chars=EXCLUDED.slide_min_chars,
        slide_max_chars=EXCLUDED.slide_max_chars, slide_min=EXCLUDED.slide_min, slide_max=EXCLUDED.slide_max,
        max_hashtags=EXCLUDED.max_hashtags, hashtag_format_rule=EXCLUDED.hashtag_format_rule,
        line_break_policy=EXCLUDED.line_break_policy, emoji_allowed=EXCLUDED.emoji_allowed,
        link_allowed=EXCLUDED.link_allowed, tag_allowed=EXCLUDED.tag_allowed,
        formatting_rules=EXCLUDED.formatting_rules, posting_frequency_limit=EXCLUDED.posting_frequency_limit,
        best_posting_window=EXCLUDED.best_posting_window, notes=EXCLUDED.notes, updated_at=now()
    `, [
      pid, p.platform, p.caption_max_chars || null,
      p.hook_must_fit_first_lines === true || p.hook_must_fit_first_lines === "TRUE",
      p.hook_max_chars || null, p.slide_min_chars || null, p.slide_max_chars || null,
      p.slide_min || null, p.slide_max || null, p.max_hashtags || null,
      p.hashtag_format_rule || null, p.line_break_policy || null,
      p.emoji_allowed === true || p.emoji_allowed === "TRUE",
      p.link_allowed === true || p.link_allowed === "TRUE",
      p.tag_allowed === true || p.tag_allowed === "TRUE",
      p.formatting_rules || null, p.posting_frequency_limit || null,
      p.best_posting_window || null, p.notes || null
    ]);
    console.log("Platform constraint:", p.platform, "upserted");
  }

  // --- Risk Rules ---
  await pool.query(`DELETE FROM caf_core.risk_rules WHERE project_id = $1`, [pid]);
  const riskRows = sheet("Risk Rules");
  let riskCount = 0;
  for (const r of riskRows) {
    if (!r.flow_type) continue;
    await pool.query(`
      INSERT INTO caf_core.risk_rules (
        project_id, flow_type, trigger_condition, risk_level, auto_approve_allowed,
        requires_manual_review, escalation_level, sensitive_topics, claim_restrictions,
        rejection_reason_tag, rollback_flag, notes
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
    `, [
      pid, r.flow_type, r.trigger_condition || null, r.risk_level || null,
      r.auto_approve_allowed === true || r.auto_approve_allowed === "TRUE",
      r.requires_manual_review === true || r.requires_manual_review === "TRUE",
      r.escalation_level || null, r.sensitive_topics || null,
      r.claim_restrictions || null, r.rejection_reason_tag || null,
      r.rollback_flag === true || r.rollback_flag === "TRUE",
      r.notes || null
    ]);
    riskCount++;
  }
  console.log("Risk rules:", riskCount, "inserted");

  // --- Allowed Flow Types ---
  const flowRows = sheet("Allowed Flow Types");
  for (const f of flowRows) {
    if (!f.flow_type) continue;
    await pool.query(`
      INSERT INTO caf_core.allowed_flow_types (
        project_id, flow_type, enabled, default_variation_count, requires_signal_pack,
        requires_learning_context, allowed_platforms, output_schema_version, qc_checklist_version,
        prompt_template_id, priority_weight, notes
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      ON CONFLICT (project_id, flow_type) DO UPDATE SET
        enabled=EXCLUDED.enabled, default_variation_count=EXCLUDED.default_variation_count,
        requires_signal_pack=EXCLUDED.requires_signal_pack, requires_learning_context=EXCLUDED.requires_learning_context,
        allowed_platforms=EXCLUDED.allowed_platforms, output_schema_version=EXCLUDED.output_schema_version,
        qc_checklist_version=EXCLUDED.qc_checklist_version, prompt_template_id=EXCLUDED.prompt_template_id,
        priority_weight=EXCLUDED.priority_weight, notes=EXCLUDED.notes, updated_at=now()
    `, [
      pid, f.flow_type,
      f.enabled === true || f.enabled === "TRUE",
      f.default_variation_count || 1,
      f.requires_signal_pack === true || f.requires_signal_pack === "TRUE",
      f.requires_learning_context === true || f.requires_learning_context === "TRUE",
      f.allowed_platforms || null,
      f.output_schema_version ? String(f.output_schema_version) : null,
      f.qc_checklist_version ? String(f.qc_checklist_version) : null,
      f.prompt_template_id || null,
      f.priority_weight || null,
      f.notes || null
    ]);
    console.log("Flow type:", f.flow_type, "upserted");
  }

  // --- Prompt Versions ---
  const promptRows = sheet("Prompt versions");
  for (const p of promptRows) {
    if (!p.prompt_id || !p.flow_type) continue;
    await pool.query(`
      INSERT INTO caf_core.prompt_versions (
        project_id, flow_type, prompt_id, version, status,
        system_prompt_version, user_prompt_version, output_schema_version,
        temperature, max_tokens, experiment_tag, metadata_json
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      ON CONFLICT (project_id, flow_type, prompt_id, version) DO UPDATE SET
        status=EXCLUDED.status, system_prompt_version=EXCLUDED.system_prompt_version,
        user_prompt_version=EXCLUDED.user_prompt_version, output_schema_version=EXCLUDED.output_schema_version,
        temperature=EXCLUDED.temperature, max_tokens=EXCLUDED.max_tokens,
        experiment_tag=EXCLUDED.experiment_tag, metadata_json=EXCLUDED.metadata_json
    `, [
      pid, p.flow_type, p.prompt_id, String(p.prompt_version || "1"),
      (p.active === true || p.active === "TRUE") ? "active" : "deprecated",
      p.system_prompt_version ? String(p.system_prompt_version) : null,
      p.user_prompt_version ? String(p.user_prompt_version) : null,
      p.output_schema_version ? String(p.output_schema_version) : null,
      p.temperature || null, p.max_tokens || null,
      p.experiment_tag || null,
      JSON.stringify({
        change_reason: p.change_reason || null,
        expected_metric_shift: p.expected_metric_shift || null,
        rollback_condition: p.rollback_condition || null,
        notes: p.notes || null,
      })
    ]);
    console.log("Prompt version:", p.prompt_id, "v" + p.prompt_version, "upserted");
  }

  // --- Reference Posts ---
  const refRows = sheet("Reference_Posts");
  for (const r of refRows) {
    if (!r.reference_post_id) continue;
    await pool.query(`
      INSERT INTO caf_core.reference_posts (
        project_id, reference_post_id, platform, post_url, status, last_run_id, notes
      ) VALUES ($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT (project_id, reference_post_id) DO UPDATE SET
        platform=EXCLUDED.platform, post_url=EXCLUDED.post_url, status=EXCLUDED.status,
        last_run_id=EXCLUDED.last_run_id, notes=EXCLUDED.notes, updated_at=now()
    `, [
      pid, r.reference_post_id, r.platform || null, r.post_url || null,
      r.status || "pending", r.last_run_id || null, r.notes || null
    ]);
    console.log("Reference post:", r.reference_post_id, "upserted");
  }

  // --- Viral Format Library ---
  const viralRows = sheet("Viral Format Library");
  for (const v of viralRows) {
    if (!v.reference_post_id) continue;
    const parseJson = (s) => {
      if (!s) return null;
      if (typeof s === "object") return JSON.stringify(s);
      try { JSON.parse(s); return s; } catch { return JSON.stringify(s); }
    };
    await pool.query(`
      INSERT INTO caf_core.viral_formats (
        project_id, reference_post_id, platform, post_url, asset_type, author_handle,
        timestamp_utc, duration_seconds, caption, hashtags_json, views, likes, comments_count,
        audio_id, music_artist, music_title, hook_type, hook_text, hook_seconds,
        pattern_structure_json, emotional_arc, retention_devices_json, cta_pattern,
        replication_template_json, transcript_full, notes, run_id
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20::jsonb,$21,$22::jsonb,$23,$24::jsonb,$25,$26,$27)
      ON CONFLICT (project_id, reference_post_id, platform) DO UPDATE SET
        post_url=EXCLUDED.post_url, asset_type=EXCLUDED.asset_type, author_handle=EXCLUDED.author_handle,
        timestamp_utc=EXCLUDED.timestamp_utc, duration_seconds=EXCLUDED.duration_seconds,
        caption=EXCLUDED.caption, hashtags_json=EXCLUDED.hashtags_json, views=EXCLUDED.views,
        likes=EXCLUDED.likes, comments_count=EXCLUDED.comments_count,
        hook_type=EXCLUDED.hook_type, hook_text=EXCLUDED.hook_text, hook_seconds=EXCLUDED.hook_seconds,
        pattern_structure_json=EXCLUDED.pattern_structure_json, emotional_arc=EXCLUDED.emotional_arc,
        retention_devices_json=EXCLUDED.retention_devices_json, cta_pattern=EXCLUDED.cta_pattern,
        replication_template_json=EXCLUDED.replication_template_json, transcript_full=EXCLUDED.transcript_full,
        notes=EXCLUDED.notes
    `, [
      pid, v.reference_post_id, v.platform || null, v.post_url || null,
      v.asset_type || null, v.author_handle || null,
      v.timestamp_utc || null, v.duration_seconds || null,
      v.caption || null,
      parseJson(v.hashtags_json) || "[]",
      v.views || null, v.likes || null, v.comments_count || null,
      v.audio_id || null, v.music_artist || null, v.music_title || null,
      v.hook_type || null, v.hook_text || null, v.hook_seconds || null,
      parseJson(v.pattern_structure_json) || "[]",
      v.emotional_arc || null,
      parseJson(v.retention_devices_json) || "[]",
      v.cta_pattern || null,
      parseJson(v.replication_template_json) || "{}",
      v.transcript_full || null, v.notes || null, v.run_id || null
    ]);
    console.log("Viral format:", v.reference_post_id, v.platform, "upserted");
  }

  // --- HeyGen Config ---
  const heygenRows = sheet("HEYGEN CONFIG");
  for (const h of heygenRows) {
    if (!h.config_id || !h.config_key) continue;
    await pool.query(`
      INSERT INTO caf_core.heygen_config (
        project_id, config_id, platform, flow_type, config_key, value, render_mode, value_type, is_active, notes
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT (project_id, config_id) DO UPDATE SET
        platform=EXCLUDED.platform, flow_type=EXCLUDED.flow_type, config_key=EXCLUDED.config_key,
        value=EXCLUDED.value, render_mode=EXCLUDED.render_mode, value_type=EXCLUDED.value_type,
        is_active=EXCLUDED.is_active, notes=EXCLUDED.notes, updated_at=now()
    `, [
      pid, h.config_id, h.platform || null, h.flow_type || null,
      h.config_key, h.value != null ? String(h.value) : null,
      h.render_mode || null, h.value_type || "string",
      h.is_active === true || h.is_active === "TRUE" || h.is_active === "",
      h.notes || null
    ]);
    console.log("HeyGen config:", h.config_key, "upserted");
  }

  console.log("\nDone! All project config imported for", PROJECT_SLUG);
  await pool.end();
}

main().catch(err => { console.error(err); process.exit(1); });
