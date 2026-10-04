import type { DebateSetup, SavedPrompt } from './prompt-types.js';

// Built-in Debate prompts (G8): formal motions, each side assigned, as in competitive debate. Every debater gets a private
// brief (through its 1:1 line before the debate starts) with its strongest lines of argument, the evidence to find, and
// what the other side will say. Motions are real trade-offs with evidence on both sides, so seven rounds hold up.
export type Starter = Pick<SavedPrompt, 'id' | 'name' | 'mode' | 'buildKind' | 'text'> & { debate?: DebateSetup };

const debate = (proposition: string, opposition: string, internet = true, rounds = 7): DebateSetup =>
  ({ rounds, agents: { cli1: { stance: 'for', context: proposition, internet }, cli2: { stance: 'against', context: opposition, internet } } });
const starter = (id: string, name: string, motion: string, definitions: string, setup: DebateSetup): Starter =>
  ({ id, name, mode: 'conversation', buildKind: 'build', text: `# Motion: ${motion}\n\n${definitions}`, debate: setup });

export const DEBATE_STARTERS: Starter[] = [
  starter('debate-smartphones-schools', 'Ban smartphones in schools', 'This house would ban smartphones in schools',
    'Schools means primary and secondary schools. The ban covers the whole school day, breaks included, with exceptions for medical needs.',
    debate('Your strongest lines: attention and learning, bullying and social pressure during the day, and the countries and school systems that have introduced bans. Find the studies and the official evaluations of those bans. Expect the Opposition to say the evidence is mixed, that parents want contact for safety, and that schools should teach responsible use instead; have answers ready.',
      'Your strongest lines: the evidence on bans is weaker and more mixed than headlines suggest, enforcement costs teachers time, phones matter for safety and for students with additional needs, and schools should teach digital skills rather than avoid them. Find the studies that found small or no effects. Expect the Proposition to cite countries and schools that report improvements; question how those results were measured.')),
  starter('debate-social-media-teens', 'Social media and teenagers', 'This house believes social media has done more harm than good to teenagers',
    'Social media means feed-based platforms such as Instagram, TikTok and Snapchat. Teenagers means 13 to 17 year olds.',
    debate('Your strongest lines: the rise in teenage anxiety, depression and self-harm since the early 2010s, experimental and natural-experiment studies, and platform design built for engagement. Find the researchers and data on both sides of this argument (it is a live academic dispute). Expect the Opposition to say the correlations are small and causation is unproven; answer with the experimental evidence and the timing.',
      'Your strongest lines: the measured associations are small, causation is disputed by leading researchers, other causes explain the trends, and social media gives teenagers connection, information and community, especially minorities and isolated teens. Find the meta-analyses and the critiques of the harm case. Expect the Proposition to cite the timing of the mental-health trends; answer on causation and alternative explanations.')),
  starter('debate-nuclear-power', 'Nuclear power and climate', 'This house believes nuclear power should be at the heart of the fight against climate change',
    'At the heart means a central part of how countries cut emissions from electricity, with new reactors built, not only existing ones kept open.',
    debate('Your strongest lines: firm low-carbon power that runs day and night, the safety record per unit of energy, land use, and grids that decarbonized with nuclear. Find the figures on deaths per terawatt-hour, capacity factors and the countries that built out nuclear. Expect the Opposition to argue cost overruns, build times and that renewables are cheaper; answer with system costs and firm capacity.',
      'Your strongest lines: new nuclear is slow and expensive, with recent projects far over budget and years late, while solar, wind and storage costs have fallen fast; money and time matter in a climate emergency. Find the costs and schedules of recent reactor projects and the latest cost comparisons. Expect the Proposition to argue reliability and land use; answer with storage, grids and the opportunity cost.')),
  starter('debate-universal-basic-income', 'Universal basic income', 'This house would introduce a universal basic income',
    'A regular cash payment to every adult, without conditions, set high enough to cover basic needs, replacing some existing benefits.',
    debate('Your strongest lines: security and freedom for workers, the costs and gaps of means-tested welfare, preparation for automation, and what cash-transfer studies and pilots found about work and wellbeing. Find the pilots and their results. Expect the Opposition to argue cost and reduced work; answer with the evidence on employment and how it could be funded.',
      'Your strongest lines: the cost at a meaningful level, the taxes it would need, money spent on people who don’t need it instead of those who do, and that pilots were small, temporary and not universal. Find the costings and the limits of the pilot evidence. Expect the Proposition to cite pilots; answer on scale, duration and funding.')),
  starter('debate-rent-control', 'Rent control', 'This house believes rent control does more harm than good',
    'Rent control means legal limits on how much rents can rise for existing tenants.',
    debate('Your strongest lines: the economic consensus that rent control reduces housing supply and quality, misallocates housing, and helps current tenants at the expense of future ones. Find the major empirical studies of cities that introduced it. Expect the Opposition to argue stability for tenants and displacement; answer with the long-run supply effects.',
      'Your strongest lines: tenants’ stability, preventing displacement and sudden rent shocks, that modern rent stabilization differs from old hard caps, and that supply depends mostly on zoning. Find the evidence on displacement and on newer designs. Expect the Proposition to cite economists and supply studies; answer that those effects can be designed around.')),
  starter('debate-four-day-week', 'The four-day week', 'This house would make the four-day working week the standard',
    'Standard means the normal full-time week becomes four days, with the same pay and no increase in daily hours.',
    debate('Your strongest lines: productivity, wellbeing, retention, and the results of the large trials of a four-day week. Find the trial reports and what share of companies kept the policy. Expect the Opposition to argue that trials were self-selected and that many jobs can’t compress hours; answer with sector examples and long-run results.',
      'Your strongest lines: trial companies chose to take part, results may not last or generalize, services such as health care need cover every day, and costs for small businesses. Find the critiques of the trials and examples of companies that dropped it. Expect the Proposition to cite the trial results; answer on selection and on sectors left out.')),
  starter('debate-open-ai-models', 'Open AI models', 'This house believes releasing the weights of frontier AI models does more good than harm',
    'Frontier models are the most capable AI models of their time. Releasing the weights means anyone can download, run and modify them.',
    debate('Your strongest lines: innovation and competition, independent safety research, transparency, avoiding concentration of power in a few companies, and the open-source record in software. Find examples of research and products built on open models. Expect the Opposition to argue misuse; answer on marginal risk and the benefits of scrutiny.',
      'Your strongest lines: weights can’t be recalled once released, safeguards can be removed by fine-tuning, misuse risks grow with capability, and adversaries gain capabilities for free. Find the evidence on safeguard removal and misuse. Expect the Proposition to argue innovation and openness; answer that the most capable models are different and that staged access exists.')),
  starter('debate-kidney-market', 'A market for kidneys', 'This house would allow a regulated market for kidney donations',
    'Living donors could be paid a set amount by a public body, with screening, consent rules and follow-up care; organs would still be allocated by medical need.',
    debate('Your strongest lines: people die on waiting lists, dialysis costs and suffering, the low risk of living donation, and the one country with a legal paid system. Find the waiting-list figures and the evidence from that system. Expect the Opposition to argue exploitation of the poor and crowding out of altruism; answer with regulation and fixed public payment.',
      'Your strongest lines: exploitation of poor and vulnerable donors, coerced consent, the record of organ trade, damage to altruistic donation, and alternatives such as opt-out systems. Find the evidence on donor outcomes in paid systems and on opt-out reforms. Expect the Proposition to cite waiting lists; answer with alternatives that raise supply without payment.')),
  starter('debate-youth-tackle-football', 'Youth tackle football', 'This house would ban tackle football for children under 14',
    'The ban applies to organized tackle football; flag football and other forms without tackling stay allowed.',
    debate('Your strongest lines: repeated head impacts in developing brains, research on early exposure and later brain health, and that flag football teaches the same skills. Find the studies on age of first exposure and head impacts in youth football. Expect the Opposition to argue the evidence is uncertain and that benefits and parental choice matter; answer with precaution for children.',
      'Your strongest lines: the evidence on youth play is uncertain, safety rules and coaching have changed, exercise and team benefits are real, children may switch to riskier activities, and parents should decide. Find the studies that found no link and the effects of rule changes. Expect the Proposition to cite brain research; answer on uncertainty, age and alternatives.')),
  starter('debate-fall-of-rome', 'The fall of Rome', 'This house believes the Western Roman Empire fell mainly because of internal causes',
    'Internal causes include political instability, civil wars, the economy, taxation and the army. External causes include the Huns, the Goths and other migrations and invasions. The period is roughly 376 to 476 AD.',
    debate('Your strongest lines: civil wars and usurpations that drained the army, fiscal and economic strain, political division between East and West, and that the Eastern Empire survived the same outside pressure. Use the historians who stress internal decline. Expect the Opposition to cite the Huns and the Gothic wars; answer that internal weakness turned pressure into collapse.',
      'Your strongest lines: the empire was coping until the Huns pushed peoples across the frontier, the disasters of Adrianople and the loss of Africa’s tax revenue were external blows, and historians who argue the fall was not inevitable. Expect the Proposition to cite civil wars and decline; answer that the East had the same problems and survived, so the outside shock decided it.', false)),
];
// Starters retired by later sets, by ID, with fingerprints of each version as shipped (name, prompt.md and debate.json).
// A library's copy that still matches is removed; an edited copy is the user's and stays.
export const RETIRED_STARTERS: Record<string, string[]> = {
  'starter-debate-car-ban': ['8fd30f1ba4f1eeacd0e3c8aa'], 'starter-debate': ['54c02871faa2386e7af8597e', 'c1d0af8d9fe326a5ff13903b'],
  'starter-vikings': ['84c232efcc94039373270d1a', 'b67b7015bd2a40540965cf27'], 'starter-debate-industrial': ['f2acdb18d1c4d2167b5b2485'],
  'starter-debate-mammoth': ['25faa989a4f2f83f593cc669'], 'starter-debate-ai-code': ['b4d4202904114f36d1b876c9'],
  'starter-debate-car-sale': ['7aef94ff6af2503c773c2516'], 'starter-debate-detective': ['4df0a53c76afd32dfd314b44'],
  'starter-debate-pitch': ['d2c35093cda0fbf71d98411b'], 'starter-debate-hot-dog': ['3b36dcf027a4324f1ee04efe'],
};
