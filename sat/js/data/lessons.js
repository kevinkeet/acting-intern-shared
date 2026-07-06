// SAT Daily — lesson cards: the essential knowledge for every tested skill.
window.SAT_LESSONS = {
  'alg-lin1': {
    title: 'Linear equations in one variable',
    points: [
      'Isolate x by undoing operations in reverse order; whatever you do to one side, do to the other.',
      'Clear fractions by multiplying every term by the least common denominator, and clear parentheses by distributing before combining like terms.',
      'If the variables cancel and you get a true statement like 5 = 5, there are infinitely many solutions; a false statement like 5 = 3 means no solution.',
      'For no solution, the x-coefficients must match but the constants differ; for infinite solutions, both coefficients and constants must match (e.g. ax + 3 = 2x + 3 has infinite solutions when a = 2).',
      'To solve for a variable in a formula (literal equation), treat every other letter as a number and isolate the target the same way.'
    ],
    tip: 'When asked for an expression like 3x + 2 rather than x itself, solve for x first, then compute the expression — or manipulate the equation directly toward that expression.'
  },
  'alg-lin2': {
    title: 'Linear equations in two variables',
    points: [
      'A linear equation in two variables, ax + by = c, has a line of solutions: every (x, y) pair on the line makes it true.',
      'Slope measures steepness and direction: m = (y₂ − y₁)/(x₂ − x₁), the change in y over the change in x between any two points.',
      'Slope-intercept form y = mx + b shows slope m and y-intercept (0, b); standard form ax + by = c has slope −a/b and intercepts (c/a, 0) and (0, c/b).',
      'To find an intercept, set the other variable to 0: x-intercept when y = 0, y-intercept when x = 0.',
      'In word problems the slope is the constant rate of change per unit and the y-intercept is the starting value when the input is 0.',
      'Parallel lines have equal slopes; perpendicular lines have slopes that multiply to −1 (negative reciprocals).'
    ],
    tip: 'When given two points or a table, compute the slope first — most answer choices differ only in slope or intercept, so slope alone often eliminates most of them.'
  },
  'alg-linfunc': {
    title: 'Linear functions',
    points: [
      'A linear function f(x) = mx + b changes by a constant amount m for every 1-unit increase in x, and f(0) = b is the initial value.',
      'Function notation f(a) means "plug a in for x"; f(a) = c means the point (a, c) is on the graph.',
      'From a table, confirm linearity by checking equal differences: equal steps in x must produce equal steps in y, and m = Δy/Δx.',
      'To build the equation from two values, find m = (f(x₂) − f(x₁))/(x₂ − x₁), then solve for b using either point.',
      'Interpretation questions ask what m or b means in context: m is the rate (units of y per unit of x) and b is the value at x = 0.'
    ],
    tip: 'For "meaning of the slope/intercept" questions, translate the number into a sentence with units — the correct choice always states the right quantity per one unit of the input.'
  },
  'alg-sys': {
    title: 'Systems of two linear equations',
    points: [
      'A solution to a system is the (x, y) pair satisfying both equations — graphically, the intersection point of the two lines.',
      'Elimination: multiply one or both equations so a variable’s coefficients are opposites, then add the equations to cancel it; substitution: solve one equation for a variable and plug it into the other.',
      'A system has no solution when the lines are parallel (same slope, different intercepts) and infinitely many when the equations are the same line (one is a multiple of the other).',
      'Written in a₁x + b₁y = c₁ and a₂x + b₂y = c₂ form: no solution when a₁/a₂ = b₁/b₂ ≠ c₁/c₂, and infinite solutions when all three ratios are equal.',
      'Many SAT systems ask for a combination like x + y or x − y — often you can just add or subtract the two equations directly instead of solving for x and y separately.'
    ],
    tip: 'Before solving fully, check whether the question wants x, y, or an expression like x + y — adding or subtracting the equations as given often produces the answer in one step.'
  },
  'alg-ineq': {
    title: 'Linear inequalities',
    points: [
      'Solve inequalities exactly like equations, with one exception: multiplying or dividing both sides by a negative number flips the inequality sign.',
      'The graph of y > mx + b is the region above the line and y < mx + b is below; use ≥ or ≤ for a solid (included) boundary line and strict inequality for a dashed one.',
      'A point is a solution to a system of inequalities only if it satisfies every inequality — test the point in each one.',
      'Translate words carefully: "at least" means ≥, "at most" means ≤, "no more than" means ≤, and "exceeds" means >.',
      'In setup problems, the bound goes on the total: for a budget, cost expression ≤ budget; for a requirement, amount expression ≥ requirement.'
    ],
    tip: 'When answer choices are inequalities, plug in an easy test point (like a boundary value or 0) to eliminate choices instead of solving algebraically.'
  },
  'adv-equiv': {
    title: 'Equivalent expressions',
    points: [
      'Exponent rules: xᵃ·xᵇ = xᵃ⁺ᵇ, xᵃ/xᵇ = xᵃ⁻ᵇ, (xᵃ)ᵇ = xᵃᵇ, x⁻ᵃ = 1/xᵃ, x⁰ = 1, and fractional exponents mean roots: x^(a/b) = (ᵇ√x)ᵃ.',
      'Key factoring patterns: x² − y² = (x + y)(x − y), x² + 2xy + y² = (x + y)², and always pull out the greatest common factor first.',
      'FOIL/distribute to expand: (x + a)(x + b) = x² + (a + b)x + ab, so the middle coefficient is the sum and the constant is the product of the roots’ opposites.',
      'Two expressions are equivalent only if they match for every value of the variable — plugging in a test value like x = 2 can quickly expose non-equivalent answer choices.',
      'When two polynomials are declared equal for all x, match coefficients term by term to solve for unknown constants.',
      'To simplify rational expressions, factor top and bottom completely and cancel common factors; polynomial division or rewriting (x + a)/(x + b) as 1 + (a − b)/(x + b) handles the rest.'
    ],
    tip: 'If the algebra looks messy, pick a small number for the variable, evaluate the original expression, and keep only the answer choice that gives the same value.'
  },
  'adv-nonlinfunc': {
    title: 'Nonlinear functions',
    points: [
      'A quadratic y = ax² + bx + c opens up if a > 0 and down if a < 0, with vertex x-coordinate x = −b/(2a) and y-intercept (0, c).',
      'Vertex form y = a(x − h)² + k shows the vertex (h, k) directly, which is the minimum (a > 0) or maximum (a < 0) of the function.',
      'Factored form y = a(x − p)(x − q) shows the x-intercepts p and q, and the vertex lies on the axis of symmetry x = (p + q)/2, midway between them.',
      'Exponential functions y = a·bˣ have starting value a and constant ratio b: growth when b > 1, decay when 0 < b < 1, and r% change per period gives b = 1 ± r/100.',
      'Linear functions change by equal differences over equal x-steps; exponential functions change by equal factors — check a table’s pattern to tell them apart.',
      'A projectile height h(t) = −at² + bt + c peaks at the vertex, starts at height c, and lands when h(t) = 0.'
    ],
    tip: 'Match the form to the question: use vertex form for max/min, factored form for zeros, and standard form for the y-intercept — convert only if the question demands it.'
  },
  'adv-nonlineq': {
    title: 'Nonlinear equations and systems',
    points: [
      'Solve quadratics by factoring and zero product property, by taking square roots when there is no x term, or with the quadratic formula x = (−b ± √(b² − 4ac))/(2a).',
      'The discriminant b² − 4ac counts real solutions: positive means two, zero means one (a double root), negative means none.',
      'For a line-parabola system, substitute one equation into the other and solve the resulting quadratic; the number of solutions equals the number of intersection points, and "exactly one intersection" means set the discriminant to 0.',
      'The sum of a quadratic’s roots is −b/a and the product is c/a — often faster than solving when a question asks about the roots combined.',
      'For radical or rational equations, isolate the radical (or clear denominators), solve, then check each answer in the original equation — squaring and clearing denominators can create extraneous solutions.'
    ],
    tip: 'When a problem says a system or equation has exactly one real solution, immediately write b² − 4ac = 0 and solve for the unknown constant.'
  },
  'psda-ratio': {
    title: 'Ratios, rates, proportions, and units',
    points: [
      'A ratio a:b compares parts; a rate is a ratio with units (like miles per hour), and a proportion sets two ratios equal: a/b = c/d means ad = bc (cross-multiply).',
      'To use a ratio like 3:5 with a known total, add the parts (3 + 5 = 8), divide the total by that sum to get one share, then multiply by each part.',
      'Convert units by multiplying by conversion fractions so unwanted units cancel: 90 km/h × (1000 m/1 km) × (1 h/3600 s) = 25 m/s.',
      'Distance = rate × time; solve for whichever quantity is missing, and keep the time units consistent with the rate.',
      'Scale problems (maps, models, similar figures) are proportions: corresponding lengths share one scale factor, but areas scale by its square.'
    ],
    tip: 'Write units into your arithmetic and make them cancel — if the leftover unit matches what the question asks for, your setup is right.'
  },
  'psda-percent': {
    title: 'Percentages',
    points: [
      'Percent means per 100: p% of a number is (p/100) × number, and "a is what percent of b" is (a/b) × 100.',
      'A p% increase multiplies by (1 + p/100) and a p% decrease multiplies by (1 − p/100); a 20% discount means paying 0.8 times the price.',
      'Percent change = (new − old)/old × 100 — always divide by the original (starting) value.',
      'Reverse percent problems divide: if a price is 84 after a 30% discount, the original is 84 ÷ 0.7 = 120, not 84 × 1.3.',
      'Successive percent changes multiply and do not simply add: a 20% increase then 20% decrease gives 1.2 × 0.8 = 0.96, a net 4% decrease.'
    ],
    tip: 'Turn every percent sentence into a multiplier immediately — "increased by 15%" becomes ×1.15 — and reverse operations by dividing by that multiplier.'
  },
  'psda-1var': {
    title: 'One-variable data: distributions and measures of center and spread',
    points: [
      'Mean = sum ÷ count, so sum = mean × count — use this to find totals, missing values, or the effect of adding/removing a data point.',
      'The median is the middle value of the ordered list (average the two middle values for an even count); the mode is the most frequent value; the range is max − min.',
      'Standard deviation measures spread around the mean: data bunched tightly has small standard deviation, data spread widely has large — you compare, never compute it.',
      'Outliers pull the mean toward them but barely move the median, so a right-skewed distribution (high outliers) has mean > median.',
      'In a frequency table or histogram, count total entries first, then locate the median by counting up to the middle position; the mean weights each value by its frequency.'
    ],
    tip: 'When a question adds or removes an extreme value, reason with the total (mean × count) for the mean, and re-find the middle position for the median.'
  },
  'psda-2var': {
    title: 'Two-variable data: models and scatterplots',
    points: [
      'A line of best fit summarizes a scatterplot’s trend; its slope is the predicted change in y per 1-unit increase in x, and its y-intercept is the predicted y when x = 0.',
      'A positive association rises left to right, a negative association falls; if points hug a line the association is linear, and if they bend it is nonlinear (often exponential or quadratic).',
      'To predict from the model, plug x into the line-of-best-fit equation — read the line, not an individual data point.',
      'A residual is actual minus predicted: points above the line have positive residuals (model underestimates), points below have negative residuals (model overestimates).',
      'Questions asking "how many points" have y greater than predicted are asking you to count points above the fitted line, and extrapolating far beyond the data range is unreliable.'
    ],
    tip: 'Keep straight whether the question asks about a data point (read the dot) or the model prediction (read the line) — most wrong answers confuse the two.'
  },
  'psda-prob': {
    title: 'Probability and conditional probability',
    points: [
      'Probability = favorable outcomes ÷ total possible outcomes, always between 0 and 1, and P(not A) = 1 − P(A).',
      'Most SAT probability questions use a two-way table: the total is the whole table (or a row/column total), and the favorable count is one cell or a sum of cells.',
      'Conditional probability "given" restricts the total: P(A given B) uses only row/column B as the denominator, not the grand total.',
      'For independent events both happening, multiply: P(A and B) = P(A) × P(B); for mutually exclusive events, add: P(A or B) = P(A) + P(B).',
      'Read category wording precisely — "or" includes either group (add, subtracting any overlap), while "and" means both conditions hold (a single cell).'
    ],
    tip: 'Underline the "given" or "of the" phrase first — it tells you which row or column total is your denominator.'
  },
  'psda-inference': {
    title: 'Inference from sample statistics and margin of error',
    points: [
      'A random sample’s statistic estimates the population value: multiply the sample proportion by the population size to estimate a population count.',
      'The margin of error gives a plausible interval for the true population value: estimate ± margin, and plausible values lie inside that interval.',
      'A margin of error does not measure mistakes or bad data — it quantifies the uncertainty from measuring a sample instead of everyone.',
      'Larger random samples give smaller margins of error and more precise estimates; smaller samples give wider intervals.',
      'Conclusions apply only to the population that was actually sampled — a survey of one school’s students says nothing about all students everywhere.'
    ],
    tip: 'The credited conclusion is the cautious one — it stays inside the interval, mentions only the sampled population, and uses hedged words like "plausible" or "likely".'
  },
  'psda-claims': {
    title: 'Evaluating statistical claims and study design',
    points: [
      'Random sampling (who is chosen) lets you generalize results to the population; random assignment to treatment groups (who gets what) lets you conclude cause and effect.',
      'With random assignment but no random sample, a causal conclusion applies only to the participants studied, not the whole population.',
      'An observational study without random assignment can show association only — never causation, because confounding variables may explain the link.',
      'Common bias traps: self-selected or volunteer samples, convenience samples, and sampling from an unrepresentative subgroup all invalidate generalization.',
      'The strongest valid conclusion matches the design exactly: check for both randomizations, then pick the choice that claims no more than the design supports.'
    ],
    tip: 'Ask two questions — "randomly sampled?" and "randomly assigned?" — and eliminate any answer choice that claims causation or generalization the design does not earn.'
  },
  'geo-area': {
    title: 'Area and volume',
    points: [
      'Core area formulas: rectangle A = lw, triangle A = ½bh (h perpendicular to the base), parallelogram A = bh, trapezoid A = ½(b₁ + b₂)h, circle A = πr².',
      'Core volume formulas: prism/cylinder V = (base area) × height, so a cylinder is V = πr²h; a box is V = lwh.',
      'Pointed solids are one-third of their prism: cone V = ⅓πr²h, pyramid V = ⅓(base area)h; sphere V = (4/3)πr³.',
      'Scaling by factor k multiplies lengths by k, areas by k², and volumes by k³ — doubling a radius quadruples a circle’s area.',
      'Many problems solve backward: set the formula equal to the given area or volume and isolate the missing dimension.',
      'For composite figures, split them into basic shapes and add, or subtract a cut-out region from the whole.'
    ],
    tip: 'The reference sheet at the start of each math module lists these formulas — glance at it rather than trusting memory under pressure.'
  },
  'geo-lines': {
    title: 'Lines, angles, and triangles',
    points: [
      'Vertical angles are equal, angles on a straight line sum to 180°, and angles around a point sum to 360°.',
      'When parallel lines are cut by a transversal, corresponding and alternate interior angles are equal, and same-side interior angles sum to 180°.',
      'Triangle angles sum to 180°, an exterior angle equals the sum of the two remote interior angles, and sides opposite bigger angles are longer.',
      'An isosceles triangle has two equal sides with equal base angles opposite them; an equilateral triangle has all sides equal and all angles 60°.',
      'Similar triangles (equal angles) have proportional sides — set up corresponding-side ratios; congruent triangles have identical sides and angles.',
      'The triangle inequality: each side must be less than the sum and greater than the difference of the other two sides.'
    ],
    tip: 'Mark every angle you can deduce directly on the figure — chaining vertical, parallel-line, and triangle-sum facts almost always walks you to the target angle.'
  },
  'geo-trig': {
    title: 'Right triangles and trigonometry',
    points: [
      'Pythagorean theorem: a² + b² = c² with c the hypotenuse; memorize the common triples 3-4-5 and 5-12-13 (and their multiples).',
      'A 45°-45°-90° triangle has sides in ratio x : x : x√2, and a 30°-60°-90° triangle has sides x : x√3 : 2x (shortest side opposite 30°).',
      'SOH-CAH-TOA: sin = opposite/hypotenuse, cos = adjacent/hypotenuse, tan = opposite/adjacent — always relative to the chosen acute angle.',
      'Complementary angle identity: sin x° = cos(90° − x°), so if sin A = cos B then A + B = 90°.',
      'Similar right triangles have equal trig ratios, so a known ratio in one triangle transfers to any triangle with the same acute angle.',
      'Radians and degrees convert by 180° = π radians: multiply degrees by π/180 to get radians.'
    ],
    tip: 'If sin of one angle equals cos of another anywhere in the problem, immediately write that the two angles sum to 90° — that identity is the whole question.'
  },
  'geo-circles': {
    title: 'Circles',
    points: [
      'Circumference C = 2πr and area A = πr²; diameter d = 2r.',
      'Standard form (x − h)² + (y − k)² = r² has center (h, k) and radius r; complete the square (add (b/2)² for each variable) to convert from expanded form.',
      'An arc or sector is a fraction of the circle: arc length = (central angle/360°) × 2πr and sector area = (central angle/360°) × πr²; in radians, arc length = rθ.',
      'A central angle equals its arc’s measure, and an inscribed angle is half the central angle that intercepts the same arc.',
      'A radius drawn to a tangent line is perpendicular to it (90°), which usually creates a right triangle to solve.'
    ],
    tip: 'If a circle equation is not in standard form, complete the square first — the center and radius answer nearly every question about it.'
  },
  'craft-wic': {
    title: 'Words in context',
    points: [
      'Cover the blank, read the full sentence, and predict your own word before looking at the choices — then pick the choice closest to your prediction.',
      'Find the context clue that controls the blank: a definition, contrast word (but, however, although), or parallel example nearby dictates the meaning.',
      'Determine the needed charge first — positive, negative, or neutral — and eliminate every choice with the wrong charge.',
      'Beware of familiar words used in secondary senses and of choices that are close in topic but wrong in precise meaning; test the survivor by reading it back into the sentence.',
      'If two choices seem synonymous, reread the clue — one will match the sentence’s specific logic or tone better; the SAT never has two fully correct answers.'
    ],
    tip: 'Predict before you peek — students who read the choices first get anchored to trap words that sound sophisticated but miss the clue.'
  },
  'craft-tsp': {
    title: 'Text structure and purpose',
    points: [
      'Purpose questions ask why the author wrote the text — identify the main function (to explain, argue, describe, compare, or introduce a question) rather than a detail it mentions.',
      'Structure questions ask how the text moves — track the shift pattern, such as claim then evidence, phenomenon then explanation, or old view then challenge.',
      'The right answer must cover the whole text: eliminate choices that describe only one sentence or only part of the passage.',
      'Verbs in the choices are decision points — check whether the text actually argues, critiques, illustrates, or merely describes, and eliminate choices whose verb overreaches.',
      'For "function of the underlined sentence" questions, read the sentences before and after to see what job it does in the flow — setup, support, concession, or conclusion.'
    ],
    tip: 'Summarize the passage’s job in five of your own words first ("explains why X happens"), then match — every wrong choice will fail either the verb or the topic.'
  },
  'craft-ctc': {
    title: 'Cross-text connections',
    points: [
      'Read Text 1 and pin down its author’s main claim in one sentence, then do the same for Text 2 before touching the choices.',
      'Classify the relationship: full agreement, full disagreement, partial agreement with a caveat, or one text qualifying, extending, or narrowing the other.',
      'The question usually asks how the author of Text 2 would respond to a specific claim in Text 1 — locate that exact claim, not just the general topic.',
      'Most often the second text agrees with the phenomenon but disputes the explanation, scope, or certainty — watch hedging words like "may," "some," and "only."',
      'Eliminate choices that misstate either author’s view or claim a stronger stance (total rejection, complete endorsement) than the text supports.'
    ],
    tip: 'Write a one-word verdict — agree, disagree, or "yes, but" — before reading the choices, and eliminate every option that contradicts your verdict.'
  },
  'info-cid': {
    title: 'Central ideas and details',
    points: [
      'The central idea is the point most of the sentences work to support — state it yourself in one sentence before reading the choices.',
      'Correct main-idea answers are supported by the entire text; wrong ones are too narrow (one detail), too broad (beyond the text), or contradict a sentence.',
      'Detail questions are lookup tasks: find the exact sentence that answers the question and match its meaning, not its vocabulary.',
      'Trap choices recycle words from the passage while distorting the meaning — paraphrase in your head and match ideas, not matching keywords.',
      'Stay strictly inside the text: an answer that is true in real life but unstated in the passage is wrong.'
    ],
    tip: 'For every choice ask "which sentence proves this?" — if you cannot point to one, eliminate it no matter how reasonable it sounds.'
  },
  'info-coe-t': {
    title: 'Command of evidence: textual',
    points: [
      'First identify exactly what claim, hypothesis, or interpretation the question wants supported (or undermined) — restate it in your own words.',
      'Break the claim into its required parts; the correct quotation or finding must address every part, not just the topic.',
      'For "support" questions pick the choice that directly illustrates or confirms the claim; for "weaken/undermine" questions pick the one that contradicts a necessary part of it.',
      'Wrong answers are on-topic but off-claim: they describe the subject, provide background, or support a different claim in the passage.',
      'Test each choice with "if this is true, does the claim become more (or less) believable?" — relevance to the claim, not interestingness, decides it.'
    ],
    tip: 'Underline the claim in the question stem and check each choice against the claim alone — never against your memory of the passage’s general topic.'
  },
  'info-coe-q': {
    title: 'Command of evidence: quantitative',
    points: [
      'Read the graph or table’s title, axis labels, units, and legend before reading the answer choices.',
      'Identify the claim the data must complete or support, and determine what pattern (higher, lower, increasing, largest gap) would do so.',
      'Verify every number and category name in a choice against the graphic — a single wrong value, wrong year, or wrong category kills the choice.',
      'The correct answer must be both true according to the data and logically relevant to the claim; many traps are accurate statistics that do not support the point.',
      'Watch for direction and magnitude errors: increases vs. decreases, which bar is largest, and whether the choice compares the right two groups.'
    ],
    tip: 'Check each choice in two passes — first "is it true in the table?" then "does it complete the argument?" — and demand a yes on both.'
  },
  'info-inf': {
    title: 'Inferences',
    points: [
      'Your job is to pick the statement that must logically follow from the passage — the safest small step, not the most interesting one.',
      'These questions usually end in a blank after "therefore" or "this suggests that" — the answer must complete the passage’s specific line of reasoning.',
      'Combine the key premises: the correct inference typically links two stated facts (often a general rule plus a specific case) without adding new information.',
      'Eliminate choices that overreach with absolute words (all, never, must, prove) when the text is hedged, and choices requiring outside knowledge.',
      'Modest, qualified language (may, some, likely) is a hallmark of right answers; extreme or off-topic conclusions are hallmarks of traps.'
    ],
    tip: 'Read the sentence right before the blank twice — the credited inference almost always follows from it plus one earlier fact, and nothing more.'
  },
  'sec-boundaries': {
    title: 'Boundaries (punctuation between and within sentences)',
    points: [
      'An independent clause has a subject and verb and can stand alone; two of them must be joined by a period, a semicolon, a comma plus FANBOYS conjunction (for, and, nor, but, or, yet, so), or a colon — a comma alone is a comma splice.',
      'A colon must follow a complete sentence and introduces an explanation, list, or example; a semicolon needs complete sentences on both sides (except in complex lists).',
      'Dependent clauses and modifiers attach with commas: a comma after an introductory phrase, and a pair of commas (or dashes or parentheses) around nonessential interrupters — never just one of the pair.',
      'Essential (identifying) information takes no commas; if you can delete the phrase and the sentence still identifies its subject, wrap it in commas.',
      'Never put a single comma between a subject and its verb or between a verb and its object, and do not break up "that" clauses with commas.',
      'Test each boundary by reading the words before and after the punctuation: complete + complete needs strong punctuation, complete + fragment needs a comma or nothing.'
    ],
    tip: 'Check what is on each side of the punctuation first — the sentence-or-fragment test decides most boundary questions before style even matters.'
  },
  'sec-form': {
    title: 'Form, structure, and sense',
    points: [
      'Subject-verb agreement: cross out prepositional phrases between subject and verb ("the box of apples is"), since the noun right before the verb is often a decoy.',
      'Pronouns must match their antecedents in number — "each," "every," and company names are singular — and "its" is possessive while "it’s" means "it is"; the same pattern holds for their/they’re/there and whose/who’s.',
      'Verb tense must stay consistent with the passage’s time frame and surrounding verbs unless a time word signals a shift.',
      'A modifier must sit next to what it describes: an opening phrase like "Walking to school," must be immediately followed by the person doing the walking.',
      'Items in a list or comparison must be parallel in form (all nouns, all -ing verbs, or all clauses), and compare like with like ("her score was higher than his," not "than him").',
      'Plurals take no apostrophe; singular possessives take ’s and plural possessives take s’ — check whether the noun owns something before adding an apostrophe.'
    ],
    tip: 'Find what differs among the answer choices (verb number, tense, pronoun, apostrophe) — that difference tells you exactly which rule the question is testing.'
  },
  'exp-transitions': {
    title: 'Transitions',
    points: [
      'First decide the relationship between the two sentences — continuation, contrast, cause/effect, example, sequence, or restatement — then pick the transition from that family.',
      'Families to know: contrast (however, nevertheless, by contrast), cause/effect (therefore, thus, consequently, as a result), addition (moreover, furthermore, additionally), example (for instance, for example), restatement (in other words, that is), sequence (then, subsequently, finally).',
      'Read the sentence before and the sentence containing the blank fully — the relationship lives between those two complete thoughts, not in the blank’s sentence alone.',
      'Classic traps offer the right family’s wrong member or a same-sounding wrong family — "however" vs. "therefore" is the most common swap, so verify direction (same direction vs. reversal).',
      'Check for subtler needs: "for example" requires the second sentence to be a specific instance of the first, and "similarly" requires a genuine parallel between two different subjects.'
    ],
    tip: 'Label the two sentences yourself as "same direction," "opposite direction," or "conclusion" before looking at choices — then eliminate entire families at once.'
  },
  'exp-synthesis': {
    title: 'Rhetorical synthesis',
    points: [
      'Skip the bullet-point notes at first and read the goal sentence in the question stem — it states exactly what the sentence must accomplish.',
      'Break the goal into its explicit requirements (e.g., "emphasize a difference," "introduce the study to a new audience," "make a comparison") and treat each as a checklist item.',
      'Eliminate any choice that fails one requirement: mentions only one subject when two are required, states a fact without the required emphasis, or assumes audience knowledge the goal says to explain.',
      'Every answer choice is factually consistent with the notes, so accuracy never decides these questions — only fit with the stated goal does.',
      'Watch audience cues: "for a general/unfamiliar audience" demands that specialized names be introduced or explained, not dropped in without context.'
    ],
    tip: 'Grade each choice against the goal sentence alone like a rubric — the notes are background, and the goal’s exact verbs and nouns are the only test.'
  }
};
