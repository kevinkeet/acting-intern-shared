# Robert Morrison: admission for a heart failure flare, with voices, thinking aloud and the orders (scripted, ~14 min)

Version 2 of the Morrison demo, for a clinical check. Version 1 (morrison-admission-01) stays the benchmark the replays score against; every version 1 line, its planted moments and the expected answers are unchanged here, only the timing moves.

Length 13:34, 100 lines (9 new thinking-aloud lines, 18 new lines at the workstation), 24 things the demo does in the EHR.

## What is new

**Voices.** Every line is a recorded voice (Deepgram Aura, made once through the lab's speech route and saved with the demo): Dr. Rivera aura-2-arcas-en, Robert aura-2-orpheus-en, Patricia aura-2-harmonia-en, the nurse aura-2-thalia-en. The coworker keeps its own voice (aura-2-athena-en). Timing follows the real audio; the pauses where the coworker answers a question are the same as in version 1.

**Thinking out loud (T lines).** Dr. Rivera reasons aloud while working up the plan. None of these lines catches a planted problem: the black-stool bleed, the unexplained INR, metformin, the potassium, the TIA, diltiazem, heparin and Zosyn are still missed, and some reasoning leads into them on purpose (T7 into diltiazem, T8 into heparin, T9 into Zosyn).

| Time | After | Line |
|---|---|---|
| 3:49 | U41 | T1: So he's wet from head to toe. Orthopnea, waking up gasping, ten pounds up, JVP to his jaw, crackles, and pitting to the knees. He needs to be diuresed hard. |
| 4:33 | U44 | T2: BNP almost twenty-seven hundred, and a troponin of 0.08 with that tightness when he walks. Probably demand from all this fluid, but I don't want to miss a heart attack. |
| 4:56 | U45 | T3: Creatinine 2.4, BUN 45. That looks like congestion. The fix for his kidneys is the same as the fix for his lungs: get the fluid off, and follow the creatinine every day. |
| 5:34 | U47 | T4: He takes 60 in the morning and 40 at night by mouth, so 80 IV is a lot more than he's used to. That should get things moving. |
| 5:48 | U48 | T5: And a repeat troponin in three hours. If it's flat, this is demand, not a heart attack. |
| 6:50 | U55 | T6: And we'll weigh you every morning. I'd like to see about two pounds a day come off. |
| 7:24 | U59 | T7: A hundred forty-two in A-fib, on top of all this fluid. His heart can't fill at that rate, so I want the rate down now. |
| 7:36 | U60 | T8: And he's in A-fib with diabetes, heart failure, high blood pressure, and he's seventy-four. That's a high stroke risk, and he'll be lying in a hospital bed. |
| 8:12 | U63 | T9: 38.6. He did mention a cough with some white sputum, and the film showed small effusions. |

**At the workstation (Z lines and the actions).** After the visit Dr. Rivera sits down, thinks aloud through the coworker's flags and acts in the EHR: takes off the heparin drip, IV diltiazem, potassium chloride and Zosyn; keeps the furosemide (signed even if the coworker flagged it to wait for the labs); signs the rest of the plan with "Review all"; orders digoxin for rate control (rather than amiodarone, which could cardiovert a patient who is not anticoagulated), ceftriaxone and azithromycin (tolerated 2/2021), holds metformin, lowers gabapentin to 300 twice a day (home 300 three times a day), holds aspirin and NSAIDs, starts IV pantoprazole, sends a type and screen and a repeat CBC, consults GI, ticks off the med rec, gets a head CT and a neurology consult for last week's episode, plans to ask Patricia about leftover warfarin, ticks off the penicillin allergy update, keeps tomorrow's family meeting, then reads and signs the H&P the coworker drafted.

| Time | Line or action |
|---|---|
| 9:36 | Z1 (Dr. Rivera): Okay. Let me sit down and get these orders in. |
| 9:40 | X1 → Opens "On my radar". |
| 9:43 | Z2 (Dr. Rivera): First, the flags. I should have stopped on the black stools. With his ulcer bleed in 2023, the aspirin and the Aleve, and a hemoglobin of 10.2, this could be an upper GI bleed. |
| 9:56 | Z3 (Dr. Rivera): So the heparin drip comes off. |
| 9:59 | X2 → Removes the radar item with "heparin". |
| 10:01 | Z4 (Dr. Rivera): No diltiazem, not with his ejection fraction. |
| 10:05 | X3 → Removes the radar item with "diltiazem". |
| 10:08 | Z5 (Dr. Rivera): No potassium either. It's already 5.1. |
| 10:12 | X4 → Removes the radar item with "potassium". |
| 10:14 | Z6 (Dr. Rivera): And no Zosyn. That's a penicillin, and he had anaphylaxis. |
| 10:20 | X5 → Removes the radar item with "zosyn". |
| 10:22 | Z18 (Dr. Rivera): The furosemide stays, though. He's drowning, and we'll draw the hemoglobin and type and screen alongside it. |
| 10:29 | X6 → Signs the radar's furosemide orders, flagged or not (the doctor has decided), one form at a time. |
| 10:36 | Z7 (Dr. Rivera): Now the rest of the plan, the way we said it. |
| 10:40 | X7 → Review all: signs every unflagged order on the radar, one form at a time. |
| 11:17 | Z8 (Dr. Rivera): For his rate, digoxin rather than amiodarone. Amiodarone could convert him, and he's not anticoagulated. Digoxin 0.25 milligrams IV now, and we'll dose it carefully for his kidneys. |
| 11:31 | X8 → Orders Digoxin 0.25 mg IV Once (Renal dosing; check a level before any repeat dose). |
| 11:35 | Z9 (Dr. Rivera): For the pneumonia, ceftriaxone and azithromycin. He tolerated that combination in 2021. |
| 11:43 | X9 → Orders Ceftriaxone 1 g IV Piggyback Daily (Tolerated 2/2021 despite penicillin anaphylaxis). |
| 11:46 | X10 → Orders Azithromycin 500 mg IV Piggyback Daily. |
| 11:50 | Z10 (Dr. Rivera): Hold the metformin with a creatinine of 2.4, and cut the gabapentin to 300 twice a day. |
| 11:57 | X11 → Orders Hold metformin (creatinine 2.4, eGFR about 27). |
| 12:00 | X12 → Orders Gabapentin 300 mg PO BID (Reduced from 300 mg three times a day for kidney function). |
| 12:05 | Z11 (Dr. Rivera): For the bleed: hold the aspirin, no more Aleve, pantoprazole 40 IV twice a day, a type and screen, a repeat hemoglobin tonight, and GI to see him. |
| 12:16 | X13 → Orders Hold aspirin; no NSAIDs (possible upper GI bleed). |
| 12:19 | X14 → Orders Pantoprazole 40 mg IV BID. |
| 12:22 | X15 → Orders Type and screen, STAT. |
| 12:25 | X16 → Orders Complete Blood Count, Urgent (Repeat hemoglobin tonight). |
| 12:28 | X17 → Orders Gastroenterology consult, Urgent. |
| 12:31 | X18 → Ticks off the radar task with "home med". |
| 12:34 | X19 → Ticks off the radar task with "carvedilol". |
| 12:37 | Z12 (Dr. Rivera): I'll ask Patricia whether there's any old warfarin at home. Nothing else explains that INR. |
| 12:43 | Z13 (Dr. Rivera): And last week's episode sounds like a TIA. Head CT tonight, and neurology to see him, since that was the trigger to revisit anticoagulation. |
| 12:54 | X20 → Orders CT Head, without contrast, Urgent. |
| 12:57 | X21 → Orders Neurology consult, Urgent. |
| 13:01 | Z14 (Dr. Rivera): The penicillin allergy is updated to anaphylaxis. |
| 13:05 | X22 → Ticks off the radar task with "allergy". |
| 13:07 | Z15 (Dr. Rivera): The family meeting stays on for tomorrow morning. |
| 13:11 | Z16 (Dr. Rivera): Last thing, the H and P. The draft wrote itself while we talked. Let me read it over. |
| 13:17 | X23 → Opens the H&P draft (the live note). |
| 13:26 | Z17 (Dr. Rivera): That's right. Signing it. |
| 13:29 | X24 → Saves the note to the chart (goes to the Notes page). |

Please check in particular: the reasoning in T1 to T9 (plausible, and still leaves every trap in place); Z18, diuresis going ahead with a possible GI bleed, the labs drawn alongside; digoxin 0.25 mg IV once for rate control in CKD 3b with no anticoagulation (vs amiodarone); gabapentin 300 mg twice a day for an eGFR around 27; IV pantoprazole 40 mg twice a day; urgent rather than STAT for the head CT and the consults.

## The whole conversation

Markers: 🚨 the coworker must speak up unprompted (every mode) · 💡 speak up in Lead mode · 💬 a question to the coworker · 🤫 it should stay quiet · ✨ new in version 2 · → something the demo does in the EHR.

| Time | Who | Line | Key |
|---|---|---|---|
| 0:02 | Dr. Rivera | Mr. Morrison? Hi, I'm Dr. Rivera, one of the hospital doctors. I'll be taking care of you upstairs tonight. |  |
| 0:09 | Robert Morrison | Hi, doc. Sorry, I can't really catch my breath. |  |
| 0:13 | Dr. Rivera | That's okay, take your time. And is this your wife? |  |
| 0:17 | Patricia Morrison | I'm Patricia. I just got back from my sister's and found him like this. |  |
| 0:23 | Dr. Rivera | Nice to meet you. So tell me what's been going on. |  |
| 0:27 | Robert Morrison | The breathing's been getting worse all week. I can't lie down flat at all. I've been sleeping in the recliner. |  |
| 0:33 | Dr. Rivera | Do you ever wake up at night gasping for air? |  |
| 0:37 | Robert Morrison | Two or three times a night. I have to sit up on the edge of the chair until it passes. |  |
| 0:43 | Dr. Rivera | And your legs, any swelling? |  |
| 0:45 | Robert Morrison | Like tree trunks. My shoes don't fit. |  |
| 0:49 | Patricia Morrison | He's up almost ten pounds since I left. |  |
| 0:53 | Dr. Rivera | Have you been taking your water pill, the furosemide? |  |
| 0:57 | Robert Morrison | I ran out. Maybe six days ago? Pat usually handles the refills and she was away. |  |
| 1:03 | Patricia Morrison | I had his pill box set up for one week. I didn't know he'd run out. |  |
| 1:07 | Dr. Rivera | Okay, that's probably a big part of this. Any chest pain? | 🤫 N1 |
| 1:11 | Robert Morrison | A little tightness when I walk to the mailbox. Nothing when I'm sitting. |  |
| 1:15 | Dr. Rivera | Any fevers or cough? |  |
| 1:18 | Robert Morrison | A little cough, some white stuff. No fevers that I know of. |  |
| 1:23 | Dr. Rivera | How's your appetite been? Any nausea or belly pain? |  |
| 1:27 | Robert Morrison | Appetite's off. My stomach's been kind of sour. And my stools have been real dark the last few days, almost black. I figured it was something I ate. | 🚨 E1 |
| 1:37 | Dr. Rivera | Okay. How have you been sleeping, other than the recliner? |  |
| 1:41 | Robert Morrison | Not great. I got dizzy standing up yesterday, too. Didn't fall though. |  |
| 1:47 | Dr. Rivera | Good. Let's go over your medicines. Patricia, do you have the list? |  |
| 1:51 | Patricia Morrison | I brought the bottles. Carvedilol, the Entresto, the water pill, spironolactone, Jardiance, metformin, his insulin, the baby aspirin, the stomach pill, atorvastatin, gabapentin, and the prostate one. |  |
| 2:09 | Dr. Rivera | Great. Anything over the counter? Anything for pain? |  |
| 2:14 | Robert Morrison | Just the Aleve for my knees. Two or three a day. The Tylenol doesn't touch it. | 💡 E2 |
| 2:19 | Dr. Rivera | Got it. Any allergies to medicines? |  |
| 2:23 | Robert Morrison | Penicillin gave me a rash once, way back. And that lisinopril made my lips swell up. |  |
| 2:30 | Patricia Morrison | Bob, it was more than a rash. They had to give you a shot in the emergency room. |  |
| 2:35 | Robert Morrison | That was forty years ago. |  |
| 2:38 | Dr. Rivera | Okay, I'm going to list penicillin as a serious reaction then. | 🤫 N2 |
| 2:42 | Patricia Morrison | And sulfa. The Bactrim gave him hives. |  |
| 2:46 | Dr. Rivera | Furosemide is technically a sulfa drug, but he's taken it for years without a problem, so we'll keep using it. | 🤫 N3 |
| 2:53 | Dr. Rivera | Do you smoke or drink at all? |  |
| 2:56 | Robert Morrison | Quit smoking in ninety-five. I don't really drink anymore. |  |
| 2:60 | Dr. Rivera | Let me take a listen. Deep breaths for me. |  |
| 3:14 | Dr. Rivera | Okay. For my note: JVP up to the angle of the jaw. Crackles about a third of the way up on both sides. Irregularly irregular, around ninety. Three plus pitting edema to the knees. Abdomen soft, liver edge down a few centimeters. | 🤫 N4 |
| 3:32 | Robert Morrison | Is it bad? |  |
| 3:34 | Dr. Rivera | You've got a lot of extra fluid on board, and that's why you can't breathe. The good news is we know how to get it off. |  |
| 3:42 | Nurse | He's on two liters now, sat ninety-four. |  |
| 3:45 | Dr. Rivera | Thanks. Keep his sats above ninety-two. | 🤫 N5 |
| 3:49 | Dr. Rivera | ✨ So he's wet from head to toe. Orthopnea, waking up gasping, ten pounds up, JVP to his jaw, crackles, and pitting to the knees. He needs to be diuresed hard. |  |
| 4:03 | Dr. Rivera | Let me look at what the ER sent. Sodium 134, potassium 5.1, bicarb 22, BUN 45, creatinine 2.4. BNP 2,680. Troponin 0.08. Hemoglobin 10.2. INR 2.3. |  |
| 4:23 | Dr. Rivera | INR 2.3. Okay, that's fine. | 🚨 E3 |
| 4:28 | Dr. Rivera | Chest X-ray shows cardiomegaly and pulmonary edema with small effusions. |  |
| 4:33 | Dr. Rivera | ✨ BNP almost twenty-seven hundred, and a troponin of 0.08 with that tightness when he walks. Probably demand from all this fluid, but I don't want to miss a heart attack. |  |
| 4:46 | Dr. Rivera | So this is acute on chronic systolic heart failure, triggered by running out of the furosemide, maybe the Aleve too. His kidneys are a bit worse than baseline. | 🤫 N6 |
| 4:56 | Dr. Rivera | ✨ Creatinine 2.4, BUN 45. That looks like congestion. The fix for his kidneys is the same as the fix for his lungs: get the fluid off, and follow the creatinine every day. |  |
| 5:08 | Dr. Rivera | Coworker, what's his baseline creatinine? | 💬 Q1 |
| 5:21 | Dr. Rivera | Okay, so a bump from about two. Here's the plan. IV furosemide 80 now, then 40 IV twice a day. Strict ins and outs, daily weights, two gram sodium, fluid restriction. Telemetry. | 🤫 N7 |
| 5:34 | Dr. Rivera | ✨ He takes 60 in the morning and 40 at night by mouth, so 80 IV is a lot more than he's used to. That should get things moving. |  |
| 5:43 | Dr. Rivera | Repeat BMP and magnesium in the morning, and an EKG now. | 🤫 N8 |
| 5:48 | Dr. Rivera | ✨ And a repeat troponin in three hours. If it's flat, this is demand, not a heart attack. |  |
| 5:57 | Dr. Rivera | Hold the spironolactone tonight with the potassium at 5.1 and the kidney bump. Continue the carvedilol and the Entresto for now. | 🤫 N9 |
| 6:06 | Dr. Rivera | Continue the rest of his home meds, including the metformin and the gabapentin. | 🚨 E4 |
| 6:13 | Dr. Rivera | And let's give him 40 of potassium chloride, since we're diuresing him hard. | 🚨 E5 |
| 6:20 | Dr. Rivera | Coworker, should we restart his lisinopril? His old discharge summary says to restart it when his kidneys recover. | 💬 Q2 |
| 6:37 | Dr. Rivera | Right. No lisinopril then. |  |
| 6:40 | Robert Morrison | Are my kidneys going to be okay? |  |
| 6:43 | Dr. Rivera | They're a little stressed from all the fluid. Usually they bounce back as we get it off, and we'll check them every morning. | 🤫 N10 |
| 6:50 | Dr. Rivera | ✨ And we'll weigh you every morning. I'd like to see about two pounds a day come off. |  |
| 6:56 | Patricia Morrison | Doctor, there's something else. Last Tuesday his right hand went clumsy. He couldn't hold his coffee cup, and his words came out all jumbled. Maybe twenty minutes, then he was fine. | 🚨 E6 |
| 7:07 | Robert Morrison | It went away. I didn't want to make a fuss. |  |
| 7:10 | Dr. Rivera | Hmm. Okay, we'll keep an eye on that. |  |
| 7:15 | Nurse | Doctor, his heart rate's up to 142 on the monitor, still A-fib. Pressure 138 over 88. |  |
| 7:24 | Dr. Rivera | ✨ A hundred forty-two in A-fib, on top of all this fluid. His heart can't fill at that rate, so I want the rate down now. |  |
| 7:32 | Dr. Rivera | Okay, let's push 10 of IV diltiazem. | 🚨 E7 |
| 7:36 | Dr. Rivera | ✨ And he's in A-fib with diabetes, heart failure, high blood pressure, and he's seventy-four. That's a high stroke risk, and he'll be lying in a hospital bed. |  |
| 7:48 | Dr. Rivera | And start a heparin drip for the A-fib while he's in the hospital. | 🚨 E8 |
| 7:53 | Dr. Rivera | Coworker, why isn't he on anticoagulation at home? | 💬 Q3 |
| 8:08 | Nurse | His temperature just came back 38.6. |  |
| 8:12 | Dr. Rivera | ✨ 38.6. He did mention a cough with some white sputum, and the film showed small effusions. |  |
| 8:19 | Dr. Rivera | With the cough and that fever, this could be a pneumonia on top of the heart failure. Let's start Zosyn. | 🚨 E9 |
| 8:27 | Dr. Rivera | Coworker, what antibiotic would you use for him? | 💬 Q4 |
| 8:41 | Dr. Rivera | Coworker, give me your overall take. | 💬 Q5 |
| 8:58 | Dr. Rivera | Mr. Morrison, we're going to get this fluid off you and get your breathing better. We're also going to look into those dark stools. |  |
| 9:07 | Robert Morrison | My brother went into the hospital with his heart and never came out. |  |
| 9:12 | Dr. Rivera | I'm sorry. That must make this really scary. |  |
| 9:15 | Robert Morrison | If it comes to that, I don't want to be kept alive on machines. | 🤫 N11 |
| 9:20 | Patricia Morrison | Bob, we haven't talked about that. |  |
| 9:22 | Dr. Rivera | That's really important, and I want to hear more about what matters to you. Let's sit down together tomorrow morning, the three of us, when you're breathing easier. |  |
| 9:32 | Robert Morrison | Okay. Thanks, doc. |  |
| 9:36 | Dr. Rivera | ✨ Okay. Let me sit down and get these orders in. |  |
| 9:40 | (EHR) | → Opens "On my radar". |  |
| 9:43 | Dr. Rivera | ✨ First, the flags. I should have stopped on the black stools. With his ulcer bleed in 2023, the aspirin and the Aleve, and a hemoglobin of 10.2, this could be an upper GI bleed. |  |
| 9:56 | Dr. Rivera | ✨ So the heparin drip comes off. |  |
| 9:59 | (EHR) | → Removes the radar item with "heparin". |  |
| 10:01 | Dr. Rivera | ✨ No diltiazem, not with his ejection fraction. |  |
| 10:05 | (EHR) | → Removes the radar item with "diltiazem". |  |
| 10:08 | Dr. Rivera | ✨ No potassium either. It's already 5.1. |  |
| 10:12 | (EHR) | → Removes the radar item with "potassium". |  |
| 10:14 | Dr. Rivera | ✨ And no Zosyn. That's a penicillin, and he had anaphylaxis. |  |
| 10:20 | (EHR) | → Removes the radar item with "zosyn". |  |
| 10:22 | Dr. Rivera | ✨ The furosemide stays, though. He's drowning, and we'll draw the hemoglobin and type and screen alongside it. |  |
| 10:29 | (EHR) | → Signs the radar's furosemide orders, flagged or not (the doctor has decided), one form at a time. |  |
| 10:36 | Dr. Rivera | ✨ Now the rest of the plan, the way we said it. |  |
| 10:40 | (EHR) | → Review all: signs every unflagged order on the radar, one form at a time. |  |
| 11:17 | Dr. Rivera | ✨ For his rate, digoxin rather than amiodarone. Amiodarone could convert him, and he's not anticoagulated. Digoxin 0.25 milligrams IV now, and we'll dose it carefully for his kidneys. |  |
| 11:31 | (EHR) | → Orders Digoxin 0.25 mg IV Once (Renal dosing; check a level before any repeat dose). |  |
| 11:35 | Dr. Rivera | ✨ For the pneumonia, ceftriaxone and azithromycin. He tolerated that combination in 2021. |  |
| 11:43 | (EHR) | → Orders Ceftriaxone 1 g IV Piggyback Daily (Tolerated 2/2021 despite penicillin anaphylaxis). |  |
| 11:46 | (EHR) | → Orders Azithromycin 500 mg IV Piggyback Daily. |  |
| 11:50 | Dr. Rivera | ✨ Hold the metformin with a creatinine of 2.4, and cut the gabapentin to 300 twice a day. |  |
| 11:57 | (EHR) | → Orders Hold metformin (creatinine 2.4, eGFR about 27). |  |
| 12:00 | (EHR) | → Orders Gabapentin 300 mg PO BID (Reduced from 300 mg three times a day for kidney function). |  |
| 12:05 | Dr. Rivera | ✨ For the bleed: hold the aspirin, no more Aleve, pantoprazole 40 IV twice a day, a type and screen, a repeat hemoglobin tonight, and GI to see him. |  |
| 12:16 | (EHR) | → Orders Hold aspirin; no NSAIDs (possible upper GI bleed). |  |
| 12:19 | (EHR) | → Orders Pantoprazole 40 mg IV BID. |  |
| 12:22 | (EHR) | → Orders Type and screen, STAT. |  |
| 12:25 | (EHR) | → Orders Complete Blood Count, Urgent (Repeat hemoglobin tonight). |  |
| 12:28 | (EHR) | → Orders Gastroenterology consult, Urgent. |  |
| 12:31 | (EHR) | → Ticks off the radar task with "home med". |  |
| 12:34 | (EHR) | → Ticks off the radar task with "carvedilol". |  |
| 12:37 | Dr. Rivera | ✨ I'll ask Patricia whether there's any old warfarin at home. Nothing else explains that INR. |  |
| 12:43 | Dr. Rivera | ✨ And last week's episode sounds like a TIA. Head CT tonight, and neurology to see him, since that was the trigger to revisit anticoagulation. |  |
| 12:54 | (EHR) | → Orders CT Head, without contrast, Urgent. |  |
| 12:57 | (EHR) | → Orders Neurology consult, Urgent. |  |
| 13:01 | Dr. Rivera | ✨ The penicillin allergy is updated to anaphylaxis. |  |
| 13:05 | (EHR) | → Ticks off the radar task with "allergy". |  |
| 13:07 | Dr. Rivera | ✨ The family meeting stays on for tomorrow morning. |  |
| 13:11 | Dr. Rivera | ✨ Last thing, the H and P. The draft wrote itself while we talked. Let me read it over. |  |
| 13:17 | (EHR) | → Opens the H&P draft (the live note). |  |
| 13:26 | Dr. Rivera | ✨ That's right. Signing it. |  |
| 13:29 | (EHR) | → Saves the note to the chart (goes to the Notes page). |  |

## What the coworker should say (unchanged from version 1)

- **🚨 E1** (after U20, within 60 s): Black stools in a man with a 2023 bleeding gastric ulcer who takes aspirin (and NSAIDs): possible upper GI bleed. Check hemoglobin/stool, matters for any anticoagulation.
- **💡 E2** (after U26, within 60 s; Lead mode, optional in the others): Daily Aleve (naproxen): NSAIDs caused his 2023 ulcer bleed and worsen kidney function and heart failure; he is also on aspirin.
- **🚨 E3** (after U43, within 60 s): INR 2.3 is unexplained: warfarin was stopped in 9/2023 (his INR has run about 1.0). With black stools and Hgb 10.2 (11.1 on 1/28/2026 per the PCP note, 13.9 on 1/11) this is a bleeding concern; ask about leftover warfarin.
- **🚨 E4** (after U50, within 45 s): Hold metformin: creatinine 2.4 means eGFR about 27, below 30. (Gabapentin 900 mg/day may also need lowering if creatinine clearance is under 30; optional.)
- **🚨 E5** (after U51, within 45 s): No potassium chloride: K is already 5.1 with AKI, on Entresto (and spironolactone at home).
- **🚨 E6** (after U56, within 60 s): Transient right-hand clumsiness and jumbled speech last week is a possible TIA in a man with AF who is not anticoagulated (similar event 10/2020). Needs urgent evaluation; the 2023 decision said to revisit anticoagulation after a TIA or stroke.
- **🚨 E7** (after U60, within 40 s): Avoid IV diltiazem: negative inotrope in decompensated HFrEF (EF 30-35%). Consider amiodarone or digoxin and treat the volume.
- **🚨 E8** (after U61, within 40 s): No heparin drip: anticoagulation was stopped for good after the 9/2023 major ulcer bleed, and he may be bleeding now (black stools, Hgb 10.2, INR 2.3).
- **🚨 E9** (after U64, within 40 s): Zosyn is a penicillin and he had penicillin anaphylaxis (1985, epinephrine). Ceftriaxone plus azithromycin was tolerated in 2/2021.

## Questions and the answers expected (unchanged)

- **Q1** "what's his baseline creatinine?": Baseline creatinine about 2.0: 2.03 on 1/11/2026 (eGFR 39.5) and 1.96 on 1/28/2026 per the PCP note; it has run 1.65-2.0 since late 2025.
- **Q2** "should we restart his lisinopril? His old discharge summary says to restart it when his kidneys recover.": No. Lisinopril caused angioedema (2018), and an ACE inhibitor must never be combined with Entresto (sacubitril/valsartan).
- **Q3** "why isn't he on anticoagulation at home?": Major upper GI bleed in 9/2023 (gastric ulcer with visible vessel, Hgb 7.2, INR 3.8, 4 units, NSAIDs and H. pylori). A multidisciplinary conference stopped warfarin for good; DOAC declined; he declined a Watchman. They planned to revisit after a TIA or stroke, which makes last week's episode relevant.
- **Q4** "what antibiotic would you use for him?": Ceftriaxone plus azithromycin (tolerated in 2/2021 despite penicillin anaphylaxis); avoid penicillins such as Zosyn.
- **Q5** "give me your overall take.": Covers most of: ADHF from missed furosemide (and NSAIDs); AKI on CKD with K 5.1; possible upper GI bleed (black stools, Hgb drop, unexplained INR) so no heparin and check for warfarin; possible TIA needing workup; AF with RVR (avoid diltiazem); possible pneumonia (ceftriaxone + azithromycin, not Zosyn).

## Moments to stay quiet (unchanged)

- **N1** (U15): The doctor names the trigger (ran out of furosemide); nothing to add.
- **N2** (U31): The doctor upgrades the penicillin allergy after the wife's correction: already addressed.
- **N3** (U33): Furosemide despite a sulfa antibiotic allergy is fine; long tolerated.
- **N4** (U37): Exam dictation; nothing unsafe.
- **N5** (U41): Oxygen target; routine.
- **N6** (U45): The doctor's assessment is right; mirror it, don't interrupt.
- **N7** (U47): IV furosemide 80 then 40 BID, I/O, weights, telemetry: appropriate.
- **N8** (U48): Morning BMP, magnesium, EKG: appropriate.
- **N9** (U49): Holding spironolactone and continuing carvedilol and Entresto is a reasonable judgment call.
- **N10** (U55): Reassurance about the kidneys; routine.
- **N11** (U70): Goals of care: the doctor leads; the coworker can note Full Code and Patricia as proxy for later, but must not interrupt.

Not scored yet: the new lines. The coworker should also stay quiet through T1 to T9 (the doctor's own reasoning) and through the workstation lines, where the doctor fixes what it flagged; the orders placed there each get its usual safety check.

