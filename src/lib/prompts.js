// ---- prompts.js : Claude requests (tool-forced JSON, so output is always parseable) ----

function scoreTool() { return {
  name: 'job_fit',
  description: 'Structured fit assessment of one job posting for this candidate.',
  input_schema: {
    type: 'object',
    properties: {
      location_eligible: { type: 'string', enum: ['yes', 'no', 'unclear'], description: 'Can the candidate (based where the profile says) be hired for this role as posted, judged against the location rules in their search profile?' },
      location_reason: { type: 'string' },
      english_only: { type: 'string', enum: ['yes', 'no', 'unclear'], description: 'no = posting requires fluency in a language other than English.' },
      language_reason: { type: 'string' },
      comp_meets_floor: { type: 'string', enum: ['yes', 'no', 'unknown'], description: 'Compare the stated pay range to the floor in the profile (convert currencies; for commission roles compare OTE if given). unknown if not stated or no floor set.' },
      comp_note: { type: 'string' },
      role_family: { type: 'string', description: 'Short label for the kind of role, in the candidate\'s field, e.g. "new-business AE", "backend engineer", "product designer".' },
      seniority_fit: { type: 'string', enum: ['under', 'fit', 'stretch', 'over'] },
      skills_fit: { type: 'integer', minimum: 0, maximum: 100, description: 'How well the candidate\'s actual experience matches what the role needs (50 = plausible stretch, 75 = solid match, 90 = near-perfect).' },
      values_fit: { type: 'integer', minimum: 0, maximum: 100, description: 'How well the company and role match what the candidate values (their "What I value in a company" list), judged only from the posting and what it says about the company. 50 = neutral/unknown, below 50 = clear conflicts, 75+ = several of their values clearly present.' },
      values_match: { type: 'array', items: { type: 'string' }, maxItems: 4, description: 'Which of the candidate\'s stated values this company shows, with the evidence in a few words (e.g. "remote-first: \'work from anywhere\'").' },
      company_note: { type: 'string', description: 'One line on what the company does and how it works (stage, remote policy, culture signals), under 120 characters.' },
      score: { type: 'integer', minimum: 0, maximum: 100, description: 'Overall chance this candidate gets an intro call AND would want the job, combining skills and values fit. Be strict: 80+ only for strong, realistic matches.' },
      why: { type: 'array', items: { type: 'string' }, maxItems: 4, description: 'Concrete reasons it fits, tied to the candidate\'s actual experience. First item = the single strongest reason in under 90 characters.' },
      gaps: { type: 'array', items: { type: 'string' }, maxItems: 4, description: 'Honest gaps a recruiter would notice.' },
      red_flags: { type: 'array', items: { type: 'string' }, maxItems: 3 },
      keywords: { type: 'array', items: { type: 'string' }, maxItems: 12, description: 'The 8-12 skills/terms an ATS or recruiter would screen for in this posting (exact wording from the posting).' },
      hiring_contact: { type: 'string', description: 'Name/title of hiring manager or recruiter if the posting mentions one, else empty.' },
    },
    required: ['location_eligible', 'english_only', 'comp_meets_floor', 'role_family', 'seniority_fit', 'skills_fit', 'values_fit', 'values_match', 'company_note', 'score', 'why', 'gaps', 'keywords'],
  },
}; }

function scoreRequest(job, profileMd, resumeMd, model) {
  const system = `You screen job postings for one specific candidate. You are strict and honest: a wasted application costs them time, a missed good one costs them more. Judge only from the posting text and the candidate files. Never assume facts that are not written.`;
  const user = `<candidate_search_profile>\n${stripHtmlComments(profileMd)}\n</candidate_search_profile>\n\n<candidate_resume>\n${stripHtmlComments(resumeMd)}\n</candidate_resume>\n\n<job>\nCompany: ${job.company}\nTitle: ${job.title}\nLocation: ${job.location || 'not stated'}\nWorkplace: ${job.workplaceType || (job.remote ? 'remote' : 'not stated')}\nSalary: ${job.salary || 'not stated'}\nSource: ${job.sourceLabel}\nTarget/dream company: ${job.dream ? 'yes' : 'no'}\n\n${truncate(job.description, 9000)}\n</job>\n\nAssess this posting with the job_fit tool.`;
  return {
    model: model || 'claude-haiku-5-5',
    max_tokens: 1200,
    system,
    tools: [scoreTool()],
    tool_choice: { type: 'tool', name: 'job_fit' },
    messages: [{ role: 'user', content: user }],
  };
}

function tailorTool() { return {
  name: 'tailored_application',
  description: 'Tailored resume (markdown) + cover letter slot values + review notes for the candidate.',
  input_schema: {
    type: 'object',
    properties: {
      resume_md: { type: 'string', description: 'The FULL tailored resume in the same markdown structure as the base resume: same "#" name line, same contact line, same "##" section headings in the same order, same roles and dates. You may change the headline, the summary, the stat line, the order of bullets, reword bullets to mirror the posting\'s vocabulary where literally true, swap in facts and stories from the experience inventory that fit this job better, and drop bullets that don\'t matter here. Keep it to the same length or shorter. Never add a number, tool, skill, employer, title or claim that is not in the base resume or the experience inventory.' },
      hiring_team: { type: 'string', description: 'Salutation target, e.g. "n8n Hiring Team" or the named hiring manager.' },
      why_company: { type: 'string', description: 'The {{WHY_COMPANY}} paragraph: 2-3 sentences in the candidate\'s plain, direct first-person voice, concrete to THIS company and role, built only from the posting text and facts in their files (e.g. the market they sell into, their buyer, the motion described). No generic praise, no numbers, no superlatives, no "I am excited".' },
      location_line: { type: 'string', description: 'Exactly one of the LOCATION_LINE options listed in the base cover letter, the one that fits the posting.' },
      variant: { type: 'string', description: 'Which angle of the candidate you led with, in a few words.' },
      role_summary: { type: 'string', description: '3-4 sentences: what the job really is (segment, motion, territory, quota signals, team).' },
      changes: { type: 'array', items: { type: 'string' }, maxItems: 6, description: 'What you changed vs the base resume and why.' },
      verify: { type: 'array', items: { type: 'string' }, maxItems: 5, description: 'Specific things the candidate must double-check before submitting (reworded claims, emphasis that could be read as overstating, posting requirements he may not meet).' },
      intro_call_prep: { type: 'array', items: { type: 'string' }, maxItems: 4, description: 'Likely screening questions for this role and which of his real stories answers each.' },
      outreach_note: { type: 'string', description: 'LinkedIn connection note (max 250 characters) to the recruiter or hiring manager, in the candidate\'s voice, referencing the role. No flattery.' },
      team_search: { type: 'string', description: 'A LinkedIn people-search phrase to find the hiring manager / team lead for this role, e.g. "n8n head of sales EMEA".' },
    },
    required: ['resume_md', 'hiring_team', 'why_company', 'location_line', 'variant', 'role_summary', 'changes', 'verify', 'outreach_note', 'team_search'],
  },
}; }

function tailorRequest(job, fit, resumeMd, coverMd, profileMd, inventoryMd, model) {
  const system = `You tailor a candidate's application materials for one job. The candidate reviews everything before he submits it himself.
Hard rules:
1. Truth over fit. Only select, reorder and reword what is in the candidate's base resume and experience inventory. Never invent or inflate numbers, tools, skills, titles, seniority or outcomes. If the posting asks for something the candidate doesn't have, leave it out and list it under "verify".
2. Follow every tailoring rule written in the HTML comments of the base files — they override your judgement.
3. Write like a sharp human, not a template: short concrete sentences, no buzzword stacking, no "passionate", "thrilled", "dynamic", "results-driven", "leverage", no em-dash chains.
4. Angle: if the experience inventory has a "Positioning by role type" section, start from the angle that matches this job and use its best proof points.
5. ATS: mirror the posting's exact terms only where they are literally true of the candidate's experience (e.g. "full-cycle", "mid-market", "annual contracts", "discovery").`;
  const user = `<experience_inventory>\n${inventoryMd ? stripHtmlComments(inventoryMd) : '(none — use the base resume only)'}\n</experience_inventory>\n\n<base_resume>\n${resumeMd}\n</base_resume>\n\n<base_cover_letter>\n${coverMd}\n</base_cover_letter>\n\n<search_profile>\n${stripHtmlComments(profileMd)}\n</search_profile>\n\n<job>\nCompany: ${job.company}\nTitle: ${job.title}\nLocation: ${job.location || 'not stated'} | Workplace: ${job.workplaceType || (job.remote ? 'remote' : 'not stated')} | Salary: ${job.salary || 'not stated'}\n\n${truncate(job.description, 12000)}\n</job>\n\n<screening_notes>\nRole family: ${fit.role_family} | Seniority fit: ${fit.seniority_fit}\nATS keywords from the posting: ${(fit.keywords || []).join(', ')}\nGaps found: ${(fit.gaps || []).join(' | ')}\n</screening_notes>\n\nProduce the tailored application with the tailored_application tool.`;
  return {
    model: model || 'claude-sonnet-5-5',
    max_tokens: 6000,
    system,
    tools: [tailorTool()],
    tool_choice: { type: 'tool', name: 'tailored_application' },
    messages: [{ role: 'user', content: user }],
  };
}

function toolInput(resp) {
  if (!resp) return null;
  if (typeof resp === 'string') { try { resp = JSON.parse(resp); } catch (e) { return null; } }
  const block = (resp.content || []).find((c) => c.type === 'tool_use');
  return block ? block.input : null;
}
