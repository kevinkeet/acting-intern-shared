// SAT Daily — the official Digital SAT skill taxonomy (8 domains, 30 skills).
// Weights are the College Board section weights. `rotation` is the 30-day
// focus cycle: every skill is formally taught once per cycle, foundations
// first, math and reading/writing interleaved. 120 days = 4 full passes.
(function () {
  const DOMAINS = [
    {
      id: 'alg', name: 'Algebra', section: 'math', weight: 35,
      skills: [
        { id: 'alg-lin1', name: 'Linear equations (1 variable)' },
        { id: 'alg-lin2', name: 'Linear equations (2 variables)' },
        { id: 'alg-linfunc', name: 'Linear functions' },
        { id: 'alg-sys', name: 'Systems of linear equations' },
        { id: 'alg-ineq', name: 'Linear inequalities' }
      ]
    },
    {
      id: 'adv', name: 'Advanced Math', section: 'math', weight: 35,
      skills: [
        { id: 'adv-equiv', name: 'Equivalent expressions' },
        { id: 'adv-nonlinfunc', name: 'Nonlinear functions' },
        { id: 'adv-nonlineq', name: 'Nonlinear equations & systems' }
      ]
    },
    {
      id: 'psda', name: 'Problem-Solving & Data Analysis', section: 'math', weight: 15,
      skills: [
        { id: 'psda-ratio', name: 'Ratios, rates & units' },
        { id: 'psda-percent', name: 'Percentages' },
        { id: 'psda-1var', name: 'One-variable data' },
        { id: 'psda-2var', name: 'Two-variable data' },
        { id: 'psda-prob', name: 'Probability' },
        { id: 'psda-inference', name: 'Inference & margin of error' },
        { id: 'psda-claims', name: 'Evaluating statistical claims' }
      ]
    },
    {
      id: 'geo', name: 'Geometry & Trigonometry', section: 'math', weight: 15,
      skills: [
        { id: 'geo-area', name: 'Area & volume' },
        { id: 'geo-lines', name: 'Lines, angles & triangles' },
        { id: 'geo-trig', name: 'Right triangles & trig' },
        { id: 'geo-circles', name: 'Circles' }
      ]
    },
    {
      id: 'craft', name: 'Craft & Structure', section: 'rw', weight: 28,
      skills: [
        { id: 'craft-wic', name: 'Words in Context' },
        { id: 'craft-tsp', name: 'Text Structure & Purpose' },
        { id: 'craft-ctc', name: 'Cross-Text Connections' }
      ]
    },
    {
      id: 'info', name: 'Information & Ideas', section: 'rw', weight: 26,
      skills: [
        { id: 'info-cid', name: 'Central Ideas & Details' },
        { id: 'info-coe-t', name: 'Command of Evidence: Textual' },
        { id: 'info-coe-q', name: 'Command of Evidence: Quantitative' },
        { id: 'info-inf', name: 'Inferences' }
      ]
    },
    {
      id: 'sec', name: 'Standard English Conventions', section: 'rw', weight: 26,
      skills: [
        { id: 'sec-boundaries', name: 'Boundaries (punctuation)' },
        { id: 'sec-form', name: 'Form, Structure & Sense' }
      ]
    },
    {
      id: 'exp', name: 'Expression of Ideas', section: 'rw', weight: 20,
      skills: [
        { id: 'exp-transitions', name: 'Transitions' },
        { id: 'exp-synthesis', name: 'Rhetorical Synthesis' }
      ]
    }
  ];

  // 30-day focus cycle: alternates math/R&W, foundations before applications.
  const ROTATION = [
    'alg-lin1', 'sec-boundaries', 'alg-linfunc', 'craft-wic', 'alg-lin2',
    'info-cid', 'alg-sys', 'sec-form', 'alg-ineq', 'exp-transitions',
    'adv-equiv', 'info-coe-t', 'adv-nonlinfunc', 'craft-tsp', 'adv-nonlineq',
    'info-inf', 'psda-ratio', 'exp-synthesis', 'psda-percent', 'info-coe-q',
    'psda-1var', 'craft-ctc', 'psda-2var', 'geo-lines', 'psda-prob',
    'geo-trig', 'psda-inference', 'geo-circles', 'psda-claims', 'geo-area'
  ];

  const byId = {};
  DOMAINS.forEach((d) => d.skills.forEach((s) => (byId[s.id] = { ...s, domain: d })));

  window.SAT_SKILLS = {
    domains: DOMAINS,
    rotation: ROTATION,
    byId,
    all: Object.keys(byId),
    name: (id) => (byId[id] ? byId[id].name : id),
    domainOf: (id) => (byId[id] ? byId[id].domain : null),
    sectionOf: (id) => (byId[id] ? byId[id].domain.section : null)
  };
})();
