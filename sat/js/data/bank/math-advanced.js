// SAT Daily question bank — Math: Advanced Math domain.
window.SAT_QUESTIONS = (window.SAT_QUESTIONS || []).concat([
  // ── adv-equiv: equivalent expressions ──────────────────────────────
  {
    skill: 'adv-equiv', d: 1,
    q: 'Which expression is equivalent to x² − 9x + 18?',
    c: ['(x − 3)(x − 6)', '(x + 3)(x + 6)', '(x − 3)(x + 6)', '(x − 2)(x − 9)'],
    a: 0,
    exp: 'Find two numbers that multiply to 18 and add to −9: they are −3 and −6, so the factorization is (x − 3)(x − 6). Choice D uses a pair that multiplies to 18 but sums to −11.'
  },
  {
    skill: 'adv-equiv', d: 1,
    q: 'Which expression is equivalent to (2x − 5)²?',
    c: ['4x² + 25', '4x² − 20x + 25', '4x² − 10x + 25', '2x² − 20x + 25'],
    a: 1,
    exp: 'Squaring a binomial gives (2x)² − 2(2x)(5) + 5² = 4x² − 20x + 25. Choice A is the classic trap of squaring each term and dropping the middle term.'
  },
  {
    skill: 'adv-equiv', d: 1,
    q: 'For x ≠ 0, which expression is equivalent to (x³ · x⁵) / x²?',
    c: ['x⁸', 'x⁴', 'x⁶', 'x¹³'],
    a: 2,
    exp: 'Add exponents when multiplying and subtract when dividing: 3 + 5 − 2 = 6, so the result is x⁶. Choice A comes from forgetting to divide by x².'
  },
  {
    skill: 'adv-equiv', d: 1,
    q: 'Which expression is equivalent to 25x² − 49?',
    c: ['(5x − 7)²', '(5x + 7)²', '(25x − 7)(x + 7)', '(5x − 7)(5x + 7)'],
    a: 3,
    exp: 'A difference of squares factors as a² − b² = (a − b)(a + b), so 25x² − 49 = (5x − 7)(5x + 7). Choices A and B expand to include a middle term, which 25x² − 49 does not have.'
  },
  {
    skill: 'adv-equiv', d: 2,
    q: 'For x > 0, which expression is equivalent to √(48x⁶)?',
    c: ['4x³√3', '16x³√3', '4x⁴√3', '2x³√3'],
    a: 0,
    exp: 'Split the radical: √48 = √(16 · 3) = 4√3 and √(x⁶) = x³, giving 4x³√3. Choice B pulls out 16 instead of its square root 4.'
  },
  {
    skill: 'adv-equiv', d: 2,
    q: 'For x ≠ −2 and x ≠ −3, which expression is equivalent to (x² − 4)/(x² + 5x + 6)?',
    c: ['(x + 2)/(x + 3)', '(x − 2)/(x + 3)', '(x − 2)/(x − 3)', '−4/(5x + 6)'],
    a: 1,
    exp: 'Factor both parts: (x − 2)(x + 2) over (x + 2)(x + 3), then cancel (x + 2) to get (x − 2)/(x + 3). Choice D comes from illegally "canceling" the x² terms.'
  },
  {
    skill: 'adv-equiv', d: 2,
    q: 'Which expression is equivalent to x² + 8x + 3?',
    c: ['(x + 4)² + 3', '(x + 4)² − 16', '(x + 4)² − 13', '(x + 8)² − 61'],
    a: 2,
    exp: 'Complete the square: x² + 8x + 3 = (x + 4)² − 16 + 3 = (x + 4)² − 13. Choice A forgets to subtract the 16 added by squaring, and choice B drops the original constant 3.'
  },
  {
    skill: 'adv-equiv', d: 2,
    q: 'For x ≠ 0 and x ≠ −2, which expression is equivalent to 1/x + 1/(x + 2)?',
    c: ['2/(x² + 2x)', '2/(2x + 2)', '(x + 2)/(x² + 2x)', '(2x + 2)/(x² + 2x)'],
    a: 3,
    exp: 'Use the common denominator x(x + 2): the sum is (x + 2 + x)/(x² + 2x) = (2x + 2)/(x² + 2x). Choice B is the trap of adding numerators and denominators separately.'
  },
  {
    skill: 'adv-equiv', d: 2,
    q: 'If x² + y² = 40 and xy = 12, what is the value of (x + y)²?',
    c: ['64', '52', '16', '88'],
    a: 0,
    exp: 'Expand the identity: (x + y)² = x² + 2xy + y² = 40 + 2(12) = 64. Choice B forgets to double xy, and choice C is (x − y)².'
  },
  {
    skill: 'adv-equiv', d: 3,
    q: 'Which expression is equivalent to 4ˣ⁺¹ for all values of x?',
    c: ['2²ˣ⁺¹', '2²ˣ⁺²', '2ˣ⁺²', '8ˣ'],
    a: 1,
    exp: 'Rewrite the base: 4ˣ⁺¹ = (2²)ˣ⁺¹ = 2²⁽ˣ⁺¹⁾ = 2²ˣ⁺². Choice A distributes the 2 to only the x term of the exponent.'
  },
  {
    skill: 'adv-equiv', d: 3,
    q: 'Which expression is equivalent to x³ + 3x² − 4x − 12?',
    c: ['(x + 3)(x² + 4)', '(x − 3)(x − 2)(x + 2)', '(x + 3)(x − 2)(x + 2)', '(x + 3)(x − 2)²'],
    a: 2,
    exp: 'Factor by grouping: x²(x + 3) − 4(x + 3) = (x + 3)(x² − 4) = (x + 3)(x − 2)(x + 2). Choice A makes a sign error when factoring out −4.'
  },
  {
    skill: 'adv-equiv', d: 3,
    q: 'For x > 1, which expression is equivalent to (x/(x + 1)) ÷ (x²/(x² − 1))?',
    c: ['x/(x − 1)', '(x + 1)/x', 'x³/((x + 1)(x² − 1))', '(x − 1)/x'],
    a: 3,
    exp: 'Multiply by the reciprocal: x/(x + 1) · (x − 1)(x + 1)/x² = (x − 1)/x after canceling (x + 1) and one factor of x. Choice C multiplies instead of dividing.'
  },

  // ── adv-nonlinfunc: nonlinear functions ────────────────────────────
  {
    skill: 'adv-nonlinfunc', d: 1,
    q: 'The function f is defined by f(x) = (x − 3)² + 7. What is the vertex of the graph of f in the xy-plane?',
    c: ['(3, 7)', '(−3, 7)', '(3, −7)', '(−3, −7)'],
    a: 0,
    exp: 'In vertex form a(x − h)² + k the vertex is (h, k), so it is (3, 7). Choice B flips the sign of h, a common trap because of the minus sign inside the parentheses.'
  },
  {
    skill: 'adv-nonlinfunc', d: 1,
    passage: 'The population of a town t years after 2020 is modeled by P(t) = 500(1.06)ᵗ.',
    q: 'According to the model, which statement best describes the population?',
    c: ['It decreases by 6% each year', 'It increases by 6% each year', 'It increases by 106% each year', 'It increases by 6 people each year'],
    a: 1,
    exp: 'A growth factor of 1.06 means each year the population is multiplied by 1.06, a 6% increase. Choice C confuses the growth factor 1.06 with the percent change.'
  },
  {
    skill: 'adv-nonlinfunc', d: 1,
    q: 'In the xy-plane, what is the y-intercept of the graph of y = 2ˣ + 3?',
    c: ['(0, 3)', '(0, 1)', '(0, 4)', '(0, 5)'],
    a: 2,
    exp: 'Substitute x = 0: y = 2⁰ + 3 = 1 + 3 = 4, so the intercept is (0, 4). Choice B forgets to add 3, and choice A treats 2⁰ as 0.'
  },
  {
    skill: 'adv-nonlinfunc', d: 1,
    q: 'What is the maximum value of the function f(x) = −2(x − 1)² + 8?',
    c: ['−2', '1', '−8', '8'],
    a: 3,
    exp: 'Since the leading coefficient is negative, the parabola opens downward and the maximum is the k-value of the vertex, 8. Choice B is the x-coordinate where the maximum occurs, not the maximum value.'
  },
  {
    skill: 'adv-nonlinfunc', d: 2,
    passage: 'A ball is launched straight up from the ground. Its height in feet t seconds after launch is modeled by h(t) = −16t² + 64t.',
    q: 'According to the model, how many seconds after launch does the ball return to the ground?',
    c: ['4', '2', '16', '64'],
    a: 0,
    exp: 'Set h(t) = 0 and factor: −16t(t − 4) = 0, so t = 0 or t = 4; the ball returns at t = 4. Choice B is the time of maximum height (the vertex), not the landing time.'
  },
  {
    skill: 'adv-nonlinfunc', d: 2,
    q: 'What is the minimum value of the function f(x) = x² − 6x + 5?',
    c: ['3', '−4', '5', '−6'],
    a: 1,
    exp: 'The vertex is at x = −b/(2a) = 3, and f(3) = 9 − 18 + 5 = −4. Choice A is the x-coordinate of the vertex, not the minimum value.'
  },
  {
    skill: 'adv-nonlinfunc', d: 2,
    passage: 'A car is purchased for $24,000. Its value decreases by 15% each year after purchase.',
    q: 'Which function models the value v(t), in dollars, of the car t years after purchase?',
    c: ['v(t) = 24,000(1.15)ᵗ', 'v(t) = 24,000(0.15)ᵗ', 'v(t) = 24,000(0.85)ᵗ', 'v(t) = 24,000 − 0.85t'],
    a: 2,
    exp: 'A 15% yearly decrease means the car keeps 85% of its value each year, so the decay factor is 0.85. Choice B uses the percent lost (0.15) as the factor instead of the percent kept.'
  },
  {
    skill: 'adv-nonlinfunc', d: 2,
    q: 'The graph of y = f(x) is shown in the xy-plane. The graph of g, where g(x) = f(x − 4), is the graph of f shifted in which direction?',
    c: ['4 units up', '4 units down', '4 units to the left', '4 units to the right'],
    a: 3,
    exp: 'Replacing x with x − 4 shifts a graph 4 units to the right, opposite to what the minus sign suggests. Choice C is the trap of reading the minus sign as a leftward shift.'
  },
  {
    skill: 'adv-nonlinfunc', d: 2,
    passage: 'The number of bacteria in a culture t hours after an experiment begins is modeled by f(t) = 300(3)ᵗ.',
    q: 'What is the best interpretation of the number 300 in this model?',
    c: ['The number of bacteria at the start of the experiment', 'The number of bacteria added each hour', 'The factor by which the bacteria multiply each hour', 'The number of bacteria after 1 hour'],
    a: 0,
    exp: 'At t = 0, f(0) = 300(3)⁰ = 300, so 300 is the starting count. Choice D is a trap: after 1 hour there are 300 · 3 = 900 bacteria.'
  },
  {
    skill: 'adv-nonlinfunc', d: 3,
    q: 'Which statement describes the end behavior of the graph of f(x) = −2x³ + 5x² − 1?',
    c: ['As x → ∞, f(x) → ∞; as x → −∞, f(x) → −∞', 'As x → ∞, f(x) → −∞; as x → −∞, f(x) → ∞', 'As x → ∞, f(x) → −∞; as x → −∞, f(x) → −∞', 'As x → ∞, f(x) → ∞; as x → −∞, f(x) → ∞'],
    a: 1,
    exp: 'End behavior follows the leading term −2x³: odd degree with a negative coefficient falls to the right and rises to the left. Choice A describes a positive leading coefficient.'
  },
  {
    skill: 'adv-nonlinfunc', d: 3,
    passage: 'A model rocket is launched from a platform. Its height in feet t seconds after launch is modeled by h(t) = −16t² + 96t + 5.',
    q: 'According to the model, what is the maximum height, in feet, the rocket reaches?',
    c: ['3', '96', '149', '144'],
    a: 2,
    exp: 'The vertex occurs at t = −96/(2 · −16) = 3, and h(3) = −144 + 288 + 5 = 149. Choice A is the time of the maximum, and choice D forgets to add the launch height 5.'
  },
  {
    skill: 'adv-nonlinfunc', d: 3,
    q: 'The function f is defined by f(x) = a · bˣ, where a and b are positive constants. If f(0) = 4 and f(2) = 36, what is the value of f(3)?',
    c: ['40', '54', '81', '108'],
    a: 3,
    exp: 'From f(0) = 4, a = 4; then 4b² = 36 gives b = 3, so f(3) = 4 · 3³ = 108. Choice C is 3⁴, from mixing up the roles of a and b.'
  },

  // ── adv-nonlineq: nonlinear equations and systems ──────────────────
  {
    skill: 'adv-nonlineq', d: 1,
    q: 'What are the solutions to the equation x² − 5x − 24 = 0?',
    c: ['x = 8 and x = −3', 'x = −8 and x = 3', 'x = 8 and x = 3', 'x = −8 and x = −3'],
    a: 0,
    exp: 'Factor as (x − 8)(x + 3) = 0, so x = 8 or x = −3. Choice B swaps the signs from the factored form.'
  },
  {
    skill: 'adv-nonlineq', d: 1,
    q: 'What are the solutions to the equation 3x² = 48?',
    c: ['x = 4 only', 'x = −4 and x = 4', 'x = −4√3 and x = 4√3', 'x = −16 and x = 16'],
    a: 1,
    exp: 'Divide by 3 to get x² = 16, so x = ±4. Choice A forgets the negative root, and choice C skips dividing by 3 before taking the square root.'
  },
  {
    skill: 'adv-nonlineq', d: 1,
    q: 'What is the solution to the equation √(x − 5) = 3?',
    c: ['−2', '4', '8', '14'],
    a: 3,
    exp: 'Square both sides: x − 5 = 9, so x = 14, which checks in the original equation. Choice C (8 = 3 + 5) comes from forgetting to square the 3.'
  },
  {
    skill: 'adv-nonlineq', d: 1,
    q: 'In the xy-plane, how many points of intersection do the graphs of y = x² and y = 4 have?',
    c: ['0', '1', '2', '4'],
    a: 2,
    exp: 'Setting x² = 4 gives x = 2 and x = −2, so the horizontal line crosses the parabola at two points. Choice D is a trap from the number 4 in the equation.'
  },
  {
    skill: 'adv-nonlineq', d: 2,
    q: 'What are the solutions to the equation x² − 6x + 2 = 0?',
    c: ['x = 3 ± √7', 'x = −3 ± √7', 'x = 3 ± 2√7', 'x = 6 ± 2√7'],
    a: 0,
    exp: 'The quadratic formula gives x = (6 ± √28)/2 = (6 ± 2√7)/2 = 3 ± √7. Choice D forgets to divide by 2a, and choice C divides the 6 but not the radical.'
  },
  {
    skill: 'adv-nonlineq', d: 2,
    q: 'In the equation x² + 10x + c = 0, c is a constant. If the equation has exactly one real solution, what is the value of c?',
    c: ['5', '20', '25', '100'],
    a: 2,
    exp: 'Exactly one real solution requires the discriminant to be zero: 10² − 4c = 0, so c = 25. Choice D stops at b² = 100 without dividing by 4.'
  },
  {
    skill: 'adv-nonlineq', d: 2,
    q: 'What is the positive solution to the equation 6/(x + 1) = x?',
    c: ['1', '2', '3', '6'],
    a: 1,
    exp: 'Multiply both sides by (x + 1): 6 = x² + x, so x² + x − 6 = (x + 3)(x − 2) = 0 and the positive solution is x = 2. Choice C uses the wrong sign when factoring.'
  },
  {
    skill: 'adv-nonlineq', d: 2,
    q: 'What is the solution set of the equation √(2x + 3) = x?',
    c: ['x = 3 only', 'x = −1 only', 'x = −1 and x = 3', 'no real solutions'],
    a: 0,
    exp: 'Squaring gives x² − 2x − 3 = (x − 3)(x + 1) = 0, but x = −1 fails the check since √1 = 1 ≠ −1. Choice C keeps the extraneous solution introduced by squaring.'
  },
  {
    skill: 'adv-nonlineq', d: 2,
    q: 'The system y = x² − 4x + 7 and y = 2x − 1 is graphed in the xy-plane. If (x, y) is a solution to the system and x > 3, what is the value of y?',
    c: ['2', '3', '4', '7'],
    a: 3,
    exp: 'Set x² − 4x + 7 = 2x − 1 to get x² − 6x + 8 = (x − 2)(x − 4) = 0; with x > 3, x = 4 and y = 2(4) − 1 = 7. Choice C stops at the x-value instead of finding y.'
  },
  {
    skill: 'adv-nonlineq', d: 3,
    q: 'In the equation x² + kx + 9 = 0, k is a constant. For which values of k does the equation have no real solutions?',
    c: ['k < −6 or k > 6', '−6 < k < 6', 'k = −6 or k = 6', 'k < 6'],
    a: 1,
    exp: 'No real solutions requires k² − 36 < 0, which means −6 < k < 6. Choice A reverses the inequality and gives the values with two real solutions.'
  },
  {
    skill: 'adv-nonlineq', d: 3,
    q: 'What is the solution to the equation 2x/(x − 4) = 8/(x − 4) + 1?',
    c: ['x = 2', 'x = 4', 'x = 8', 'no solution'],
    a: 3,
    exp: 'Multiplying by (x − 4) gives 2x = 8 + x − 4, so x = 4 — but x = 4 makes the denominators zero, so it is extraneous and there is no solution. Choice B keeps the extraneous value.'
  },
  {
    skill: 'adv-nonlineq', d: 3,
    q: 'In the xy-plane, the graphs of y = x² + 3x and y = x + b, where b is a constant, intersect at exactly one point. What is the value of b?',
    c: ['4', '1', '−1', '−4'],
    a: 2,
    exp: 'Setting x² + 3x = x + b gives x² + 2x − b = 0, and one intersection requires the discriminant 4 + 4b = 0, so b = −1. Choice B drops the sign when solving 4 + 4b = 0.'
  }
]);
