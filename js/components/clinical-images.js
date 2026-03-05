/**
 * Clinical Images Component
 * Displays EKG and radiology images for interpretation
 * EKG requires doctor interpretation (scored in debrief)
 */

const ClinicalImages = {
    // Image sources - local files primary, fallbacks optional
    images: {
        'ekg-afib': {
            title: 'EKG - Current',
            description: '12-lead EKG obtained at bedside',
            localUrl: 'images/ekg-patient.png',
            url: 'images/ekg-afib.svg',   // Fallback to existing SVG
            fallbackUrl: null,
            findings: [],                   // Empty: doctor must interpret
            interpretation: '',             // Empty: no giveaway
            requiresInterpretation: true,   // Flag: show interpretation input
            credit: 'Clinical EKG (teaching purposes)'
        },
        'cxr-chf': {
            title: 'Chest X-Ray - PA View',
            description: 'Portable chest radiograph',
            localUrl: 'images/cxr-chf.svg',
            url: 'https://upload.wikimedia.org/wikipedia/commons/5/5e/Chest_radiograph_of_a_lung_with_Kerley_B_lines.jpg',
            fallbackUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/5e/Chest_radiograph_of_a_lung_with_Kerley_B_lines.jpg/600px-Chest_radiograph_of_a_lung_with_Kerley_B_lines.jpg',
            findings: [
                'Cardiomegaly (cardiothoracic ratio >0.5)',
                'Bilateral interstitial markings',
                'Kerley B lines at lung bases',
                'Cephalization of pulmonary vasculature',
                'Small bilateral pleural effusions'
            ],
            interpretation: 'Findings consistent with congestive heart failure with pulmonary edema',
            credit: 'Simulation illustration (clinical teaching purposes)'
        }
    },

    // Track which images have been viewed
    viewedImages: new Set(),

    // User's EKG interpretation (null = not submitted)
    userInterpretation: null,

    /**
     * Initialize the component
     */
    init() {
        this.createModal();
        console.log('Clinical Images component initialized');
    },

    /**
     * Create the image viewer modal
     */
    createModal() {
        const modal = document.createElement('div');
        modal.id = 'clinical-image-modal';
        modal.className = 'clinical-image-modal';
        modal.innerHTML = `
            <div class="clinical-image-backdrop" onclick="ClinicalImages.close()"></div>
            <div class="clinical-image-content">
                <div class="clinical-image-header">
                    <h2 id="clinical-image-title">Clinical Image</h2>
                    <button class="clinical-image-close" onclick="ClinicalImages.close()">&times;</button>
                </div>
                <div class="clinical-image-body">
                    <div class="clinical-image-container">
                        <img id="clinical-image-img" src="" alt="Clinical image" />
                        <div class="clinical-image-loading">Loading image...</div>
                    </div>
                    <div class="clinical-image-details">
                        <div class="clinical-image-description" id="clinical-image-description"></div>
                        <div class="clinical-image-findings" id="clinical-image-findings"></div>
                        <div class="clinical-image-interpretation" id="clinical-image-interpretation"></div>
                        <div class="clinical-image-credit" id="clinical-image-credit"></div>
                    </div>
                </div>
                <!-- EKG Interpretation Input (shown only for EKGs) -->
                <div class="clinical-image-interpret" id="clinical-image-interpret" style="display: none;">
                    <div class="interpret-prompt">
                        <h4>Your Interpretation</h4>
                        <p>What rhythm do you see? Include rate, rhythm, and any notable findings.</p>
                    </div>
                    <div class="interpret-input-row">
                        <input type="text" id="ekg-interpretation-input"
                               placeholder="e.g., sinus tachycardia, atrial fibrillation with RVR..."
                               autocomplete="off" />
                        <button class="btn btn-primary" id="ekg-submit-btn" onclick="ClinicalImages.submitInterpretation()">
                            Submit
                        </button>
                    </div>
                    <div class="interpret-feedback" id="interpret-feedback" style="display: none;"></div>
                </div>
                <div class="clinical-image-footer">
                    <button class="btn" id="findings-toggle-btn" onclick="ClinicalImages.toggleFindings()">
                        <span id="findings-toggle-text">Show Findings</span>
                    </button>
                    <button class="btn btn-primary" onclick="ClinicalImages.close()">Close</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    },

    /**
     * Show an image
     */
    show(imageId) {
        const image = this.images[imageId];
        if (!image) {
            console.error('Image not found:', imageId);
            return;
        }

        const modal = document.getElementById('clinical-image-modal');
        const img = document.getElementById('clinical-image-img');
        const title = document.getElementById('clinical-image-title');
        const description = document.getElementById('clinical-image-description');
        const findings = document.getElementById('clinical-image-findings');
        const interpretation = document.getElementById('clinical-image-interpretation');
        const credit = document.getElementById('clinical-image-credit');

        // Set content
        title.textContent = image.title;
        description.textContent = image.description;

        // Build findings HTML (only if findings exist)
        const hasFindings = image.findings && image.findings.length > 0;
        if (hasFindings) {
            let findingsHtml = '<h4>Findings:</h4><ul>';
            image.findings.forEach(function(f) {
                findingsHtml += '<li>' + f + '</li>';
            });
            findingsHtml += '</ul>';
            findings.innerHTML = findingsHtml;
        } else {
            findings.innerHTML = '';
        }
        findings.style.display = 'none';

        if (image.interpretation) {
            interpretation.innerHTML = '<h4>Interpretation:</h4><p>' + image.interpretation + '</p>';
        } else {
            interpretation.innerHTML = '';
        }
        interpretation.style.display = 'none';

        credit.textContent = 'Image: ' + image.credit;

        // Show/hide findings toggle button based on whether findings exist
        const findingsBtn = document.getElementById('findings-toggle-btn');
        if (findingsBtn) {
            findingsBtn.style.display = hasFindings ? 'inline-block' : 'none';
        }
        document.getElementById('findings-toggle-text').textContent = 'Show Findings';

        // Show/hide interpretation input for EKGs
        const interpretSection = document.getElementById('clinical-image-interpret');
        if (interpretSection) {
            if (image.requiresInterpretation) {
                interpretSection.style.display = 'block';
                const input = document.getElementById('ekg-interpretation-input');
                const submitBtn = document.getElementById('ekg-submit-btn');
                const feedback = document.getElementById('interpret-feedback');
                if (this.userInterpretation) {
                    // Already submitted — show read-only state
                    if (input) { input.value = this.userInterpretation; input.disabled = true; }
                    if (submitBtn) submitBtn.disabled = true;
                    if (feedback) {
                        feedback.style.display = 'block';
                        feedback.innerHTML = '<p>Interpretation recorded. This will be reviewed in your debrief.</p>';
                    }
                } else {
                    // Fresh — ready for input
                    if (input) { input.value = ''; input.disabled = false; }
                    if (submitBtn) submitBtn.disabled = false;
                    if (feedback) feedback.style.display = 'none';
                }
            } else {
                interpretSection.style.display = 'none';
            }
        }

        // Load image with cascading fallbacks: local → url → fallbackUrl → text-only
        img.style.display = 'none';
        modal.querySelector('.clinical-image-loading').style.display = 'block';
        modal.querySelector('.clinical-image-loading').textContent = 'Loading image...';

        let fallbackAttempt = 0;
        const fallbackChain = [
            image.localUrl,
            image.url,
            image.fallbackUrl
        ].filter(Boolean);

        img.onload = function() {
            img.style.display = 'block';
            modal.querySelector('.clinical-image-loading').style.display = 'none';
        };

        img.onerror = function() {
            fallbackAttempt++;
            if (fallbackAttempt < fallbackChain.length) {
                img.src = fallbackChain[fallbackAttempt];
            } else {
                // All image sources failed — show text-only fallback
                img.style.display = 'none';
                modal.querySelector('.clinical-image-loading').innerHTML =
                    '<div class="image-unavailable">' +
                    '<div style="font-size: 48px; margin-bottom: 12px; opacity: 0.4;">&#128444;</div>' +
                    '<div style="font-weight: 500; margin-bottom: 8px;">Image unavailable</div>' +
                    '<div style="font-size: 12px; color: #888;">See findings and interpretation below</div>' +
                    '</div>';
                // Auto-show findings when image can't load (if they exist)
                if (hasFindings) {
                    findings.style.display = 'block';
                    interpretation.style.display = 'block';
                    document.getElementById('findings-toggle-text').textContent = 'Hide Findings';
                }
            }
        };

        img.src = fallbackChain[0];

        // Show modal
        modal.classList.add('visible');

        // Track that image was viewed
        this.viewedImages.add(imageId);

        // Record for scoring
        if (typeof SimulationEngine !== 'undefined' && typeof SimulationEngine.recordDecision === 'function') {
            SimulationEngine.recordDecision('IMAGE_REVIEW', 'viewed_' + imageId, { imageId: imageId, title: image.title });
        }
    },

    /**
     * Submit EKG interpretation for scoring
     */
    submitInterpretation() {
        const input = document.getElementById('ekg-interpretation-input');
        const feedback = document.getElementById('interpret-feedback');
        const submitBtn = document.getElementById('ekg-submit-btn');
        if (!input || !feedback) return;

        const text = input.value.trim();
        if (!text) {
            if (typeof App !== 'undefined') {
                App.showToast('Please type your interpretation first', 'error');
            }
            return;
        }

        // Store the interpretation
        this.userInterpretation = text;

        // Score it via the score tracker
        if (typeof SimulationScoreTracker !== 'undefined' && typeof SimulationScoreTracker.trackEKGInterpretation === 'function') {
            SimulationScoreTracker.trackEKGInterpretation(text);
        }

        // Record as a decision in the simulation engine
        if (typeof SimulationEngine !== 'undefined' && typeof SimulationEngine.recordDecision === 'function') {
            SimulationEngine.recordDecision('EKG_INTERPRETATION', text, { imageId: 'ekg-afib' });
        }

        // Show neutral feedback (don't reveal the answer)
        feedback.style.display = 'block';
        feedback.innerHTML = '<p>Interpretation recorded. This will be reviewed in your debrief.</p>';

        // Disable the input after submission
        input.disabled = true;
        if (submitBtn) submitBtn.disabled = true;

        // Show toast
        if (typeof App !== 'undefined') {
            App.showToast('EKG interpretation recorded', 'info');
        }
    },

    /**
     * Toggle findings visibility
     */
    toggleFindings() {
        const findings = document.getElementById('clinical-image-findings');
        const interpretation = document.getElementById('clinical-image-interpretation');
        const toggleText = document.getElementById('findings-toggle-text');

        if (findings.style.display === 'none') {
            findings.style.display = 'block';
            interpretation.style.display = 'block';
            toggleText.textContent = 'Hide Findings';
        } else {
            findings.style.display = 'none';
            interpretation.style.display = 'none';
            toggleText.textContent = 'Show Findings';
        }
    },

    /**
     * Close the modal
     */
    close() {
        const modal = document.getElementById('clinical-image-modal');
        if (modal) {
            modal.classList.remove('visible');
        }
    },

    /**
     * Check if an image has been viewed
     */
    hasViewed(imageId) {
        return this.viewedImages.has(imageId);
    },

    /**
     * Get EKG for current state
     */
    getCurrentEKG() {
        return 'ekg-afib';
    },

    /**
     * Get CXR
     */
    getCXR() {
        return 'cxr-chf';
    }
};

window.ClinicalImages = ClinicalImages;
