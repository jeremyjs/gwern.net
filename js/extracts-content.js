/***************************************************************************/
/*  The target-testing and pop-frame-filling functions in this section
	come in sets, which define and implement classes of pop-frames
	(whether those be popups, or popins, etc.). (These classes are things
	like “a link that has a statically generated extract provided for it”,
	“a link to a locally archived web page”, “an anchorlink to a section of
	the current page”, and so on.)

	Each set contains a testing function, which is called by
	testTarget() to determine if the target (link, etc.) is eligible for
	processing, and is also called by fillPopFrame() to find the
	appropriate filling function for a pop-frame spawned by a given
	target. The testing function takes a target element and examines its
	href or other properties, and returns true if the target is a member of
	that class of targets, false otherwise.

	NOTE: These testing (a.k.a. “type predicate”) functions SHOULD NOT be used
	directly, but only via Extracts.targetTypeInfo()!

	Each set also contains the corresponding filling function, which
	is called by fillPopFrame() (chosen on the basis of the return values
	of the testing functions, and the specified order in which they’re
	called). The filling function takes a target element and returns a
	string which comprises the HTML contents that should be injected into
	the pop-frame spawned by the given target.
 */

Extracts.targetTypeDefinitions.insertBefore([
	"LOCAL_PAGE",          // Type name
	"isLocalPageLink",     // Type predicate function
	"has-content",         // Target classes to add
	"localPageForTarget",  // Pop-frame fill function
	"local-page"           // Pop-frame classes
], (def => def[0] == "ANNOTATION_PARTIAL"));

/*=-------------=*/
/*= LOCAL PAGES =*/
/*=-------------=*/

Extracts = { ...Extracts,
    /*  Local links (to sections of the current page, or other site pages).
     */
    //  Called by: Extracts.targetTypeInfo (as `predicateFunctionName`)
    isLocalPageLink: (target) => {
        return (   Content.contentTypes.localPage.matches(target)
				&& (   isAnchorLink(target)
					|| target.pathname != location.pathname));
    },

    /*  TOC links.
     */
    //  Called by: Extracts.testTarget_LOCAL_PAGE
    //  Called by: Extracts.preparePopup_LOCAL_PAGE
    isTOCLink: (target) => {
        return (target.closest("#TOC") != null);
    },

    /*  Links in the sidebar.
     */
    //  Called by: Extracts.testTarget_LOCAL_PAGE
    isSidebarLink: (target) => {
        return (target.closest("#sidebar") != null);
    },

	/*	“Full context” links in backlinks lists.
	 */
	isFullBacklinkContextLink: (target) => {
		return (   target.closest(".backlink-source") != null
				&& target.classList.contains("link-page"));
	},

    /*  This “special testing function” is used to exclude certain targets which
        have already been categorized as (in this case) `LOCAL_PAGE` targets. It
        returns false if the target is to be excluded, true otherwise. Excluded
        targets will not spawn pop-frames.
     */
    //  Called by: Extracts.targets.testTarget (as `testTarget_${targetTypeInfo.typeName}`)
    testTarget_LOCAL_PAGE: (target) => {
        return (!(   Extracts.popFrameProvider == Popins
        		  && (   Extracts.isTOCLink(target)
        			  || Extracts.isSidebarLink(target))));
    },

    //  Called by: Extracts.fillPopFrame (as `popFrameFillFunctionName`)
    //	Called by: Extracts.citationForTarget (extracts-content.js)
    //	Called by: Extracts.citationBackLinkForTarget (extracts-content.js)
    localPageForTarget: (target, forceNarrow) => {
        GWLog("Extracts.localPageForTarget", "extracts.js", 2);

		/*  Check to see if the target location matches an already-displayed
			page (which can be the root page of the window).

			If the entire linked page is already displayed, and if the
			target points to an anchor in that page, display the linked
			section or element.

			Also display just the linked block if we’re spawning this
			pop-frame from an in-pop-frame TOC.

			Otherwise, display the entire linked page.
		 */
		let fullPage = !(   isAnchorLink(target)
        				 && (   forceNarrow
        					 || target.closest(".TOC")
        					 || Extracts.targetDocument(target)));
        if (fullPage) {
            /*  Note that we might end up here because there is yet no
                pop-frame with the full linked document, OR because there is
                such a pop-frame but it’s a pinned popup or something (and thus
                we didn’t want to despawn it and respawn it at this target’s
                location).
            */
			/*  Mark the pop-frame as a full page embed, and give it suitable
				identifying classes.
			 */
			Extracts.popFrameProvider.addClassesToPopFrame(target.popFrame, "full-page");
        }

		//	Designate “full context” pop-frames for backlinks.
		if (Extracts.isFullBacklinkContextLink(target))
			Extracts.popFrameProvider.addClassesToPopFrame(target.popFrame, "full-backlink-context");

		//	Synthesize include-link (with or without hash, as appropriate).
		let includeLink = synthesizeIncludeLink(target, { class: "include-block-context" });
		if (fullPage) {
			stripAnchorsFromLink(includeLink);
		} else if (   Extracts.isFullBacklinkContextLink(target)
				   && target.pathname == location.pathname) {
			/*	Since “full” context is just the base page, which we don’t want 
				to pop up/in, we instead show the containing section or
				footnote.
			 */
			let targetElement = targetElementInDocument(target, Extracts.rootDocument);
			let nearestSection = targetElement.closest("section, li.footnote");
			if (nearestSection)
				includeLink.hash = "#" + nearestSection.id;
		}

		return newDocument(includeLink);
    },

    //  Called by: Extracts.titleForPopFrame (as `titleForPopFrame_${targetTypeName}`)
    titleForPopFrame_LOCAL_PAGE: (popFrame) => {
        GWLog("Extracts.titleForPopFrame_LOCAL_PAGE", "extracts.js", 2);

        let target = popFrame.spawningTarget;
        let referenceData = Content.referenceDataForLink(target);

		let popFrameTitleText, popFrameTitleLinkHref;
		if (referenceData == null) {
			popFrameTitleText = "";
			if (target.pathname != location.pathname)
				popFrameTitleText += target.pathname;
			if (popFrame.classList.contains("full-page") == false)
				popFrameTitleText += target.hash;
			popFrameTitleText = `<code>${popFrameTitleText}</code>`;

			popFrameTitleLinkHref = target.href;
		} else {
			popFrameTitleText = popFrame.classList.contains("full-page")
								? referenceData.popFrameTitleTextShort
								: referenceData.popFrameTitleText;
			popFrameTitleLinkHref = referenceData.popFrameTitleLinkHref;
		}

		if (popFrame.classList.contains("backlinks")) {
			popFrameTitleText += " (Backlinks)";
		}

		return Transclude.fillTemplateNamed("pop-frame-title-standard", {
			popFrameTitleLinkHref:  popFrameTitleLinkHref,
			popFrameTitleText:      popFrameTitleText
		}, Extracts.getStandardPopFrameTitleTemplateFillContext());
    },

	preparePopFrame_LOCAL_PAGE: (popFrame) => {
        GWLog("Extracts.preparePopFrame_LOCAL_PAGE", "extracts.js", 2);

        let target = popFrame.spawningTarget;

		/*	For local content embed pop-frames, add handler to trigger
			transcludes in source content when they trigger in the pop-frame.
		 */
		if (Content.cachedDataExists(target)) {
			GW.notificationCenter.addHandlerForEvent("GW.contentDidInject", (info) => {
				Content.updateCachedContent(target, (content) => {
					Transclude.allIncludeLinksInContainer(content).filter(includeLink =>
						includeLink.href == info.includeLink.href
					).forEach(includeLink => {
						Transclude.transclude(includeLink, true);
					});
				});
			}, { condition: (info) => (   info.source == "transclude"
									   && info.document == popFrame.document) });
		}

		return popFrame;
	},

    //  Called by: Extracts.preparePopup (as `preparePopup_${targetTypeName}`)
    preparePopup_LOCAL_PAGE: (popup) => {
        GWLog("Extracts.preparePopup_LOCAL_PAGE", "extracts.js", 2);

        let target = popup.spawningTarget;

		popup = Extracts.preparePopFrame_LOCAL_PAGE(popup);

		//  Do not spawn “full context” popup if the link is visible.
 		if (   Extracts.isFullBacklinkContextLink(target)
 			&& popup.classList.contains("full-page") == false
 			&& Popups.isVisible(targetElementInDocument(target, Extracts.rootDocument)))
			return null;

       /*  Designate popups spawned from section links in the the TOC (for
            special styling).
         */
        if (Extracts.isTOCLink(target))
        	Extracts.popFrameProvider.addClassesToPopFrame(popup, "toc-section");

        return popup;
    },

    //  Called by: Extracts.rewritePopinContent_LOCAL_PAGE
    //  Called by: Extracts.rewritePopupContent_LOCAL_PAGE
    //  Called by: Extracts.rewritePopinContent (as `rewritePopFrameContent_${targetTypeName}`)
    //  Called by: Extracts.rewritePopupContent (as `rewritePopFrameContent_${targetTypeName}`)
    rewritePopFrameContent_LOCAL_PAGE: (popFrame, injectEventInfo = null) => {
        GWLog("Extracts.rewritePopFrameContent_LOCAL_PAGE", "extracts.js", 2);

		if (injectEventInfo == null) {
			GW.notificationCenter.addHandlerForEvent("GW.contentDidInject", (info) => {
				Extracts.rewritePopFrameContent_LOCAL_PAGE(popFrame, info);
			}, {
				phase: "rewrite",
				condition: (info) => (   info.source == "transclude"
									  && info.document == popFrame.document),
				once: true
			});

			//	Trigger transcludes.
			Transclude.triggerTranscludesInContainer(popFrame.body, {
				source: "Extracts.rewritePopFrameContent_LOCAL_PAGE",
				container: popFrame.body,
				document: popFrame.document,
				context: "popFrame"
			});

			return;
		}

		//	REAL REWRITES BEGIN HERE

        let target = popFrame.spawningTarget;

		//	Add page body classes.
		let referenceData = Content.referenceDataForLink(target);
		Extracts.popFrameProvider.addClassesToPopFrame(popFrame, ...(referenceData.pageBodyClasses));

		//	Update pop-frame title.
		Extracts.updatePopFrameTitle(popFrame);

		//	Provider-specific rewrites.
		if (Extracts.popFrameProvider == Popups)
			Extracts.rewritePopupContent_LOCAL_PAGE(popFrame, injectEventInfo);
		else // if (Extracts.popFrameProvider == Popins)
			Extracts.rewritePopinContent_LOCAL_PAGE(popFrame, injectEventInfo);

		//	Something failed somehow.
		if (isNodeEmpty(injectEventInfo.container)) {
			Extracts.popFrameProvider.addClassesToPopFrame(popFrame, "loading-failed");
			return;
		}

		//	Make first image load eagerly.
		let firstImage = (   popFrame.body.querySelector(".page-thumbnail")
						  || popFrame.body.querySelector("figure img"))
		if (firstImage) {
			firstImage.loading = "eager";
			firstImage.decoding = "sync";
		}

		//	Strip a single collapse block encompassing the top level content.
		if (   isOnlyChild(injectEventInfo.container.firstElementChild)
			&& injectEventInfo.container.firstElementChild.classList.contains("collapse"))
			expandLockCollapseBlock(injectEventInfo.container.firstElementChild);

		//	Designate section backlinks popups as such.
		if (injectEventInfo.container.firstElementChild.classList.containsAnyOf([ "section-backlinks", "section-backlinks-container" ]))
			Extracts.popFrameProvider.addClassesToPopFrame(popFrame, "aux-links", "backlinks");

		/*	In the case where the spawning link points to a specific element
			within the transcluded content, but we’re transcluding the full
			page and not just the block context of the targeted element,
			transclude.js has not marked the targeted element for us already.
			So we must do it here.
		 */
		if (   isAnchorLink(target)
			&& popFrame.classList.containsAnyOf([ "full-page", "full-backlink-context" ]))
			targetElementInDocument(target, popFrame.document).classList.add("block-context-highlighted");

		//  Scroll to the target.
		Extracts.scrollToTargetedElementInPopFrame(popFrame);

		//	Lazy-loading of adjacent sections.
		//	WARNING: Experimental code!
// 		if (target.hash > "") {
// 			requestAnimationFrame(() => {
// 				Extracts.loadAdjacentSections(popFrame, "next,prev");
// 			});
// 		}
    },

    //  Called by: Extracts.rewritePopupContent (as `rewritePopupContent_${targetTypeName}`)
    rewritePopupContent_LOCAL_PAGE: (popup, injectEventInfo = null) => {
        GWLog("Extracts.rewritePopupContent_LOCAL_PAGE", "extracts.js", 2);

		if (injectEventInfo == null) {
			Extracts.rewritePopFrameContent_LOCAL_PAGE(popup);
			return;
		}

        let target = popup.spawningTarget;

		let referenceData = Content.referenceDataForLink(target);
		if (referenceData) {
			//	Insert page thumbnail into page abstract.
			if (   referenceData.pageThumbnailHTML
				&& popup.document.querySelector("img.page-thumbnail") == null) {
				let pageAbstract = popup.document.querySelector("#page-metadata + .abstract blockquote");
				if (pageAbstract)
					pageAbstract.insertAdjacentHTML("afterbegin", `<figure>${referenceData.pageThumbnailHTML}</figure>`);
			}
		}

        //  Make anchorlinks scroll popup instead of opening normally.
		Extracts.constrainLinkClickBehaviorInPopFrame(popup);
    },

    //  Called by: Extracts.rewritePopinContent (as `rewritePopinContent_${targetTypeName}`)
    rewritePopinContent_LOCAL_PAGE: (popin, injectEventInfo = null) => {
        GWLog("Extracts.rewritePopinContent_LOCAL_PAGE", "extracts.js", 2);

		if (injectEventInfo == null) {
			Extracts.rewritePopFrameContent_LOCAL_PAGE(popin);
			return;
		}

        /*  Make anchorlinks scroll popin instead of opening normally
        	(but only for non-popin-spawning anchorlinks).
         */
		Extracts.constrainLinkClickBehaviorInPopFrame(popin, (link => link.classList.contains("no-popin")));
    },

	loadAdjacentSections: (popFrame, which) => {
        GWLog("Extracts.loadAdjacentSections", "extracts.js", 2);

		which = which.split(",");
		let next = which.includes("next");
		let prev = which.includes("prev");

		let target = popFrame.spawningTarget;
		let sourceDocument = Extracts.cachedPages[target.pathname] || Extracts.rootDocument;

		popFrame.firstSection = popFrame.firstSection || targetElementInDocument(target, sourceDocument);
		popFrame.lastSection = popFrame.lastSection || popFrame.firstSection;

		if (!(next || prev))
			return;

		if (targetElementInDocument(target, popFrame.document) == null) {
			let sectionWrapper = newElement("SECTION", {
				"id": popFrame.firstSection.id,
				"class": [ ...(popFrame.firstSection.classList) ].join(" ")
			});
			sectionWrapper.replaceChildren(...(popFrame.body.children));
			popFrame.body.appendChild(sectionWrapper);

			//  Fire a contentDidInject event.
			GW.notificationCenter.fireEvent("GW.contentDidInject", {
				source: "Extracts.loadAdjacentSections",
				container: popFrame.body.firstElementChild,
				document: popFrame.document,
				loadLocation: new URL(target.href)
			});
		}

		let prevSection = popFrame.firstSection.previousElementSibling;
		if (prev && prevSection) {
			popFrame.body.insertBefore(newDocument(prevSection), popFrame.body.firstElementChild);

			//  Fire a contentDidInject event.
			GW.notificationCenter.fireEvent("GW.contentDidInject", {
				source: "Extracts.loadAdjacentSections",
				container: popFrame.body.firstElementChild,
				document: popFrame.document,
				loadLocation: new URL(target.href)
			});

			popFrame.firstSection = prevSection;
		}

		let nextSection = popFrame.lastSection.nextElementSibling;
		if (next && nextSection) {
			popFrame.body.insertBefore(newDocument(nextSection), null);

			//  Fire a contentDidInject event.
			GW.notificationCenter.fireEvent("GW.contentDidInject", {
				source: "Extracts.loadAdjacentSections",
				container: popFrame.body.lastElementChild,
				document: popFrame.document,
				loadLocation: new URL(target.href)
			});

			popFrame.lastSection = nextSection;
		}
	}
};

/*=-----------------=*/
/*= AUXILIARY LINKS =*/
/*=-----------------=*/

Extracts.targetTypeDefinitions.insertBefore([
    "AUX_LINKS_LINK",       // Type name
    "isAuxLinksLink",       // Type predicate function
    "has-content",          // Target classes to add
    "auxLinksForTarget",    // Pop-frame fill function
    "aux-links"             // Pop-frame classes
], (def => def[0] == "LOCAL_PAGE"));

Extracts = { ...Extracts,
    //  Called by: Extracts.isLocalCodeFileLink
    //  Called by: extracts.js (as `predicateFunctionName`)
    isAuxLinksLink: (target) => {
        let auxLinksLinkType = AuxLinks.auxLinksLinkType(target);
        return (   auxLinksLinkType != null
                && target.classList.contains(auxLinksLinkType));
    },

    /*  This “special testing function” is used to exclude certain targets which
        have already been categorized as (in this case) `AUX_LINKS_LINK` targets.
        It returns false if the target is to be excluded, true otherwise.
        Excluded targets will not spawn pop-frames.
     */
    //  Called by: Extracts.targets.testTarget (as `testTarget_${targetTypeInfo.typeName}`)
    testTarget_AUX_LINKS_LINK: (target) => {
        let exclude = false;
        let auxLinksType = AuxLinks.auxLinksLinkType(target);
        let containingAnnotation = target.closest(".annotation");
        if (containingAnnotation) {
            let includedAuxLinksBlock = containingAnnotation.querySelector(`.${auxLinksType}-append`);
            if (includedAuxLinksBlock)
                exclude = true;
        }

        return (!(   Extracts.popFrameProvider == Popins
                  && exclude == true));
    },

    /*  Backlinks, similar-links, etc.
     */
    //  Called by: extracts.js (as `popFrameFillFunctionName`)
    auxLinksForTarget: (target) => {
        GWLog("Extracts.auxLinksForTarget", "extracts-content.js", 2);

		return newDocument(synthesizeIncludeLink(target, { class: AuxLinks.auxLinksLinkType(target) }));
    },

    //  Called by: Extracts.preparePopFrame (as `preparePopFrame_${targetTypeName}`)
    preparePopFrame_AUX_LINKS_LINK: (popFrame) => {
        GWLog("Extracts.preparePopFrame_AUX_LINKS_LINK", "extracts-content.js", 2);

        let auxLinksLinkType = AuxLinks.auxLinksLinkType(popFrame.spawningTarget);
        if (auxLinksLinkType > "")
            Extracts.popFrameProvider.addClassesToPopFrame(popFrame, auxLinksLinkType);

        return popFrame;
    },

    //  Called by: extracts.js (as `rewritePopFrameContent_${targetTypeName}`)
    rewritePopFrameContent_AUX_LINKS_LINK: (popFrame, injectEventInfo = null) => {
        let target = popFrame.spawningTarget;

		if (injectEventInfo == null) {
			GW.notificationCenter.addHandlerForEvent("GW.contentDidInject", (info) => {
				Extracts.rewritePopFrameContent_AUX_LINKS_LINK(popFrame, info);
			}, {
				phase: "rewrite",
				condition: (info) => (   info.source == "transclude"
									  && info.document == popFrame.document),
				once: true
			});

			//	Trigger transcludes.
			Transclude.triggerTranscludesInContainer(popFrame.body, {
				source: "Extracts.rewritePopFrameContent_AUX_LINKS_LINK",
				container: popFrame.body,
				document: popFrame.document,
				context: "popFrame"
			});

			return;
		}

		//	REAL REWRITES BEGIN HERE

		if (Extracts.popFrameProvider == Popups) {
			popFrame.document.querySelectorAll(".backlink-source a:nth-of-type(2)").forEach(fullContextLink => {
				let targetDocument = Extracts.targetDocument(fullContextLink);
				if (targetDocument) {
					let targetElement = targetElementInDocument(fullContextLink, targetDocument);
					fullContextLink.addEventListener("mouseenter", (event) => {
						targetElement.classList.toggle("block-context-highlighted-temp", true);
					});
					fullContextLink.addEventListener("mouseleave", (event) => {
						targetElement.classList.toggle("block-context-highlighted-temp", false);
					});
					GW.notificationCenter.addHandlerForEvent("Popups.popupWillDespawn", (info) => {
						targetElement.classList.toggle("block-context-highlighted-temp", false);
					}, {
						once: true,
						condition: (info) => (info.popup == popFrame)
					});
				}
			});
		}
    },

    //  Called by: extracts.js (as `titleForPopFrame_${targetTypeName}`)
    titleForPopFrame_AUX_LINKS_LINK: (popFrame) => {
        let target = popFrame.spawningTarget;
        let targetPage = AuxLinks.targetOfAuxLinksLink(target);
        let auxLinksLinkType = AuxLinks.auxLinksLinkType(target);
        switch (auxLinksLinkType) {
		case "backlinks":
			return newDocument(`<code>${targetPage}</code><span> (Backlinks)</span>`);
		case "similars":
			return newDocument(`<code>${targetPage}</code><span> (Similar links)</span>`);
		case "link-bibliography":
			return newDocument(`<code>${targetPage}</code><span> (Link bibliography)</span>`);
		default:
			return newDocument(`<code>${targetPage}</code>`);
        }
    },
};

/*=-----------=*/
/*= CITATIONS =*/
/*=-----------=*/

Extracts.targetTypeDefinitions.insertBefore([
    "CITATION",             // Type name
    "isCitation",           // Type predicate function
    null,                   // Target classes to add
    "citationForTarget",    // Pop-frame fill function
    "footnote"              // Pop-frame classes
], (def => def[0] == "LOCAL_PAGE"));

Extracts = { ...Extracts,
    //  Called by: extracts.js (as `predicateFunctionName`)
    isCitation: (target) => {
        return target.classList.contains("footnote-ref");
    },

    //  Called by: extracts.js (as `popFrameFillFunctionName`)
    citationForTarget: (target) => {
        GWLog("Extracts.citationForTarget", "extracts-content.js", 2);

		return Extracts.localPageForTarget(target, true);
    },

    //  Called by: extracts.js (as `titleForPopFrame_${targetTypeName}`)
    titleForPopFrame_CITATION: (popFrame) => {
        let target = popFrame.spawningTarget;
        let footnoteNumber = target.querySelector("sup").textContent;
        let popFrameTitleText = `Footnote #${footnoteNumber}`;

        return Extracts.standardPopFrameTitleElementForTarget(target, popFrameTitleText);
    },

    //  Called by: extracts.js (as `preparePopup_${targetTypeName}`)
    preparePopup_CITATION: (popup) => {
        let target = popup.spawningTarget;

        /*  Do not spawn footnote popup if the {side|foot}note it points to is
            visible.
         */
        if (Array.from(Notes.allNotesForCitation(target)).findIndex(note => Popups.isVisible(note)) != -1)
            return null;

        //  Mini title bar.
        popup.classList.add("mini-title-bar");

        /*  Add event listeners to highlight citation when its footnote
            popup is hovered over.
         */
        popup.addEventListener("mouseenter", (event) => {
            target.classList.toggle("highlighted", true);
        });
        popup.addEventListener("mouseleave", (event) => {
            target.classList.toggle("highlighted", false);
        });
        GW.notificationCenter.addHandlerForEvent("Popups.popupWillDespawn", (info) => {
            target.classList.toggle("highlighted", false);
        }, {
			once: true,
			condition: (info) => (info.popup == popup)
		});

        return popup;
    },

    //  Called by: extracts.js (as `rewritePopFrameContent_${targetTypeName}`)
    rewritePopFrameContent_CITATION: (popFrame, injectEventInfo = null) => {
        GWLog("Extracts.rewritePopFrameContent_CITATION", "extracts.js", 2);

		if (injectEventInfo == null) {
			GW.notificationCenter.addHandlerForEvent("GW.contentDidInject", (info) => {
				Extracts.rewritePopFrameContent_CITATION(popFrame, info);
			}, {
				phase: "rewrite",
				condition: (info) => (   info.source == "transclude"
									  && info.document == popFrame.document),
				once: true
			});

			//	Trigger transcludes.
			Transclude.triggerTranscludesInContainer(popFrame.body, {
				source: "Extracts.rewritePopFrameContent_CITATION",
				container: popFrame.body,
				document: popFrame.document,
				context: "popFrame"
			});

			return;
		}

		//	REAL REWRITES BEGIN HERE

		/*	Unwrap sidenote. (Corrects for edge case where a popup for a section
			of the current page which is currently within a collapsed section, 
			contains a footnote reference. Hovering over the citation will spawn
			a popup instead of sliding up the sidenote, as the latter is hidden.
			The sidenote, once transcluded, must then be unwrapped specially.)
		 */
		if (injectEventInfo.container.firstElementChild.classList.contains("sidenote"))
			injectEventInfo.container.replaceChildren(...(injectEventInfo.container.querySelector(".sidenote-inner-wrapper").children));
    },
};

/*=---------------------=*/
/*= CITATIONS BACKLINKS =*/
/*=---------------------=*/

Extracts.targetTypeDefinitions.insertBefore([
    "CITATION_BACK_LINK",               // Type name
    "isCitationBackLink",               // Type predicate function
    null,                               // Target classes to add
    "citationBackLinkForTarget",        // Pop-frame fill function
    "citation-context"                  // Pop-frame classes
], (def => def[0] == "LOCAL_PAGE"));

Extracts = { ...Extracts,
    //  Called by: extracts.js (as `predicateFunctionName`)
    isCitationBackLink: (target) => {
        return target.classList.contains("footnote-back");
    },

    //  Called by: extracts.js (as `popFrameFillFunctionName`)
    citationBackLinkForTarget: (target) => {
        GWLog("Extracts.citationBackLinkForTarget", "extracts-content.js", 2);

        return Extracts.localPageForTarget(target, true);
    },

    /*  This “special testing function” is used to exclude certain targets which
        have already been categorized as (in this case) `CITATION_BACK_LINK`
        targets. It returns false if the target is to be excluded, true
        otherwise. Excluded targets will not spawn pop-frames.
     */
    //  Called by: extracts.js (as `testTarget_${targetTypeInfo.typeName}`)
    testTarget_CITATION_BACK_LINK: (target) => {
        return (Extracts.popFrameProvider != Popins);
    },

    //  Called by: extracts.js (as `preparePopup_${targetTypeName}`)
    preparePopup_CITATION_BACK_LINK: (popup) => {
        let target = popup.spawningTarget;

        //  Do not spawn citation context popup if citation is visible.
        let targetDocument = Extracts.targetDocument(target);
        if (targetDocument) {
        	let targetElement = targetElementInDocument(target, targetDocument);
        	if (   targetElement
        		&& Popups.isVisible(targetElement))
        		return null;
        }

        //  Mini title bar.
        popup.classList.add("mini-title-bar");

        return popup;
    },

    //  Called by: extracts.js (as `rewritePopupContent_${targetTypeName}`)
    rewritePopupContent_CITATION_BACK_LINK: (popup, injectEventInfo = null) => {
        let target = popup.spawningTarget;

		if (injectEventInfo == null) {
			GW.notificationCenter.addHandlerForEvent("GW.contentDidInject", (info) => {
				Extracts.rewritePopupContent_CITATION_BACK_LINK(popup, info);
			}, {
				phase: "rewrite",
				condition: (info) => (   info.source == "transclude"
									  && info.document == popup.document),
				once: true
			});

			//	Trigger transcludes.
			Transclude.triggerTranscludesInContainer(popup.body, {
				source: "Extracts.rewritePopupContent_CITATION_BACK_LINK",
				container: popup.body,
				document: popup.document,
				context: "popFrame"
			});

			return;
		}

		//	REAL REWRITES BEGIN HERE

        //  Highlight citation in popup.
        /*  Remove the .targeted class from a targeted citation (if any)
            inside the popup (to prevent confusion with the citation that
            the spawning link points to, which will be highlighted).
         */
        popup.document.querySelectorAll(".footnote-ref.targeted").forEach(targetedCitation => {
            targetedCitation.classList.remove("targeted");
        });
        //  In the popup, the citation for which context is being shown.
        let citationInPopup = targetElementInDocument(target, popup.document);
        //  Highlight the citation.
        citationInPopup.classList.add("targeted");
        //	Remove class that would interfere with styling.
        citationInPopup.classList.remove("block-context-highlighted");

        //  Scroll to the citation.
        Extracts.scrollToTargetedElementInPopFrame(popup);
    }
};

/*=---------------=*/
/*= REMOTE VIDEOS =*/
/*=---------------=*/

Extracts.targetTypeDefinitions.insertBefore([
    "VIDEO",                // Type name
    "isVideoLink",          // Type predicate function
    "has-content",          // Target classes to add
    "videoForTarget",       // Pop-frame fill function
    "video object"          // Pop-frame classes
], (def => def[0] == "LOCAL_PAGE"));

Extracts = { ...Extracts,
    // Called by: Extracts.isVideoLink
    // Called by: Extracts.videoForTarget
    youtubeId: (url) => {
        let match = url.href.match(/^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/);
        if (   match
			&& match.length == 3
            && match[2].length == 11) {
            return match[2];
        } else {
            return null;
        }
    },

    // Called by: Extracts.isVideoLink
    // Called by: Extracts.videoForTarget
	vimeoId: (url) => {
		let match = url.pathname.match(/^\/([0-9]+)$/);
		if (   match
			&& match.length == 2) {
			return match[1];
		} else {
			return null;
		}
	},

    //  Called by: extracts.js (as `predicateFunctionName`)
    isVideoLink: (target) => {
        if ([ "www.youtube.com", "youtube.com", "youtu.be" ].includes(target.hostname)) {
            return (Extracts.youtubeId(target) != null);
        } else if ([ "vimeo.com" ].includes(target.hostname)) {
        	return (Extracts.vimeoId(target) != null);
        } else {
            return false;
        }
    },

    //  Called by: extracts.js (as `popFrameFillFunctionName`)
    videoForTarget: (target) => {
        GWLog("Extracts.videoForTarget", "extracts-content.js", 2);

        if ([ "www.youtube.com", "youtube.com", "youtu.be" ].includes(target.hostname)) {
			let srcdocStyles =
				  `<style>`
				+ `* { padding: 0; margin: 0; overflow: hidden; } `
				+ `html, body { height: 100%; } `
				+ `img, span { position: absolute; width: 100%; top: 0; bottom: 0; margin: auto; } `
				+ `span { height: 1.5em; text-align: center; font: 48px/1.5 sans-serif; color: white; text-shadow: 0 0 0.5em black; }`
				+ `</style>`;

			let videoId = Extracts.youtubeId(target);
			let videoEmbedURL = new URL(`https://www.youtube.com/embed/${videoId}`);
			let placeholderImgSrc = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
			let playButtonHTML = `<span class='video-embed-play-button'>&#x25BA;</span>`;
			let srcdocHTML = `<a href='${videoEmbedURL.href}?autoplay=1'><img src='${placeholderImgSrc}'>${playButtonHTML}</a>`;

			//  `allow-same-origin` only for EXTERNAL videos, NOT local videos!
			return newDocument(Extracts.objectHTMLForURL(videoEmbedURL,
				`srcdoc="${srcdocStyles}${srcdocHTML}" sandbox="allow-scripts allow-same-origin" allowfullscreen`));
        } else if ([ "vimeo.com" ].includes(target.hostname)) {
			let videoId = Extracts.vimeoId(target);
			let videoEmbedURL = new URL(`https://player.vimeo.com/video/${videoId}`);
        	return newDocument(Extracts.objectHTMLForURL(videoEmbedURL,
        		`allow="autoplay; fullscreen; picture-in-picture" allowfullscreen`));
		}
    },

    //  Called by: extracts.js (as `preparePopup_${targetTypeName}`)
    preparePopup_VIDEO: (popup) => {
		let target = popup.spawningTarget;

		if ([ "www.youtube.com", "youtube.com", "youtu.be" ].includes(target.hostname)) {
			Extracts.popFrameProvider.addClassesToPopFrame(popup, "youtube");
		} else if ([ "vimeo.com" ].includes(target.hostname)) {
			Extracts.popFrameProvider.addClassesToPopFrame(popup, "vimeo");
		}

        return popup;
    },
};

/*=-----------------------=*/
/*= LOCALLY HOSTED VIDEOS =*/
/*=-----------------------=*/

Extracts.targetTypeDefinitions.insertBefore([
    "LOCAL_VIDEO",              // Type name
    "isLocalVideoLink",         // Type predicate function
    "has-content",              // Target classes to add
    "localVideoForTarget",      // Pop-frame fill function
    "video object"              // Pop-frame class
], (def => def[0] == "LOCAL_PAGE"));

Extracts = { ...Extracts,
    //  Used in: Extracts.isLocalVideoLink
    videoFileExtensions: [ "mp4", "webm" ],

    //  Called by: extracts.js (as `predicateFunctionName`)
    isLocalVideoLink: (target) => {
        if (target.hostname != location.hostname)
            return false;

        let videoFileURLRegExp = new RegExp(
              '('
            + Extracts.videoFileExtensions.map(ext => `\\.${ext}`).join("|")
            + ')$'
        , 'i');
        return (target.pathname.match(videoFileURLRegExp) != null);
    },

    //  Called by: extracts.js (as `popFrameFillFunctionName`)
    localVideoForTarget: (target) => {
        GWLog("Extracts.localVideoForTarget", "extracts-content.js", 2);

        return newDocument(
              `<figure>`
            + `<video controls="controls" preload="none">`
            + `<source src="${target.href}">`
            + `</video></figure>`);
    },

    //  Called by: extracts.js (as `preparePopup_${targetTypeName}`)
    preparePopup_LOCAL_VIDEO: (popup) => {
        //  Mini title bar.
        popup.classList.add("mini-title-bar");

        return popup;
    },

    //  Called by: extracts.js (as `rewritePopFrameContent_${targetTypeName}`)
    rewritePopFrameContent_LOCAL_VIDEO: (popFrame) => {
    	let video = popFrame.document.querySelector("video");
    	let source = video.querySelector("source");

		Extracts.popFrameProvider.addClassesToPopFrame(popFrame, "loading");

		doAjax({
			location: source.src,
			method: "HEAD",
			onSuccess: (event) => {
				Extracts.postRefreshUpdatePopFrameForTarget(popFrame.spawningTarget, true);
			},
			onFailure: (event) => {
                Extracts.postRefreshUpdatePopFrameForTarget(popFrame.spawningTarget, false);
			}
		});
    }
};

/*=----------------------------=*/
/*= LOCALLY HOSTED AUDIO FILES =*/
/*=----------------------------=*/

Extracts.targetTypeDefinitions.insertBefore([
    "LOCAL_AUDIO",              // Type name
    "isLocalAudioLink",         // Type predicate function
    "has-content",              // Target classes to add
    "localAudioForTarget",      // Pop-frame fill function
    "audio object"              // Pop-frame class
], (def => def[0] == "LOCAL_PAGE"));

Extracts = { ...Extracts,
    //  Used in: Extracts.isLocalVideoLink
    audioFileExtensions: [ "mp3" ],

    //  Called by: extracts.js (as `predicateFunctionName`)
    isLocalAudioLink: (target) => {
        if (target.hostname != location.hostname)
            return false;

        let audioFileURLRegExp = new RegExp(
              '('
            + Extracts.audioFileExtensions.map(ext => `\\.${ext}`).join("|")
            + ')$'
        , 'i');
        return (target.pathname.match(audioFileURLRegExp) != null);
    },

    //  Called by: extracts.js (as `popFrameFillFunctionName`)
    localAudioForTarget: (target) => {
        GWLog("Extracts.localAudioForTarget", "extracts-content.js", 2);

        return newDocument(
        	  `<figure>`
            + `<audio controls="controls" preload="none">`
            + `<source src="${target.href}">`
            + `</audio></figure>`);
    },

    //  Called by: extracts.js (as `preparePopup_${targetTypeName}`)
    preparePopup_LOCAL_AUDIO: (popup) => {
        //  Mini title bar.
        popup.classList.add("mini-title-bar");

		//	Audio elements can’t get taller.
        popup.classList.add("no-resize-height");

        return popup;
    },

    //  Called by: extracts.js (as `rewritePopFrameContent_${targetTypeName}`)
    rewritePopFrameContent_LOCAL_AUDIO: (popFrame) => {
    	let audio = popFrame.document.querySelector("audio");
    	let source = audio.querySelector("source");

		Extracts.popFrameProvider.addClassesToPopFrame(popFrame, "loading");

		doAjax({
			location: source.src,
			method: "HEAD",
			onSuccess: (event) => {
				Extracts.postRefreshUpdatePopFrameForTarget(popFrame.spawningTarget, true);
			},
			onFailure: (event) => {
				Extracts.postRefreshUpdatePopFrameForTarget(popFrame.spawningTarget, false);
			}
		});
    }
};

/*=-----------------------=*/
/*= LOCALLY HOSTED IMAGES =*/
/*=-----------------------=*/

Extracts.targetTypeDefinitions.insertBefore([
    "LOCAL_IMAGE",              // Type name
    "isLocalImageLink",         // Type predicate function
    "has-content",              // Target classes to add
    "localImageForTarget",      // Pop-frame fill function
    "image object"              // Pop-frame classes
], (def => def[0] == "LOCAL_PAGE"));

Extracts = { ...Extracts,
    //  Used in: Extracts.isLocalImageLink
    imageFileExtensions: [ "bmp", "gif", "ico", "jpeg", "jpg", "png", "svg" ],

    //  Used in: Extracts.localImageForTarget
    imageMaxWidth: 634.0,
    imageMaxHeight: 453.0,

    //  Called by: extracts.js (as `predicateFunctionName`)
    isLocalImageLink: (target) => {
        if (target.hostname != location.hostname)
            return false;

        let imageFileURLRegExp = new RegExp(
              '('
            + Extracts.imageFileExtensions.map(ext => `\\.${ext}`).join("|")
            + ')$'
        , 'i');
        return (target.pathname.match(imageFileURLRegExp) != null);
    },

    //  Called by: extracts.js (as `popFrameFillFunctionName`)
    localImageForTarget: (target) => {
        GWLog("Extracts.localImageForTarget", "extracts-content.js", 2);

        let width = target.dataset.imageWidth ?? 0;
        let height = target.dataset.imageHeight ?? 0;

		//	Constrain dimensions, shrinking proportionally.
        if (width > Extracts.imageMaxWidth) {
            height *= Extracts.imageMaxWidth / width;
            width = Extracts.imageMaxWidth;
        }
        if (height > Extracts.imageMaxHeight) {
            width *= Extracts.imageMaxHeight / height;
            height = Extracts.imageMaxHeight;
        }

		//	Specify dimensions in HTML and CSS.
        let styles = ``;
        if (   width > 0
            && height > 0)
            styles = `width="${(target.dataset.imageWidth)}" `
            	   + `height="${(target.dataset.imageHeight)}" `
            	   + `style="width: ${width}px; height: ${height}px; aspect-ratio: ${width} / ${height}"`;

		//	Special handling for SVGs.
		if (target.pathname.endsWith(".svg"))
			styles = `style="width: 100%; height: 100%"`;

        /*  Note that we pass in the original image-link’s classes; this is 
        	good for classes like ‘invert’.
         */
        return newDocument(`<figure><img
                                ${styles}
                                class="${target.classList}"
                                src="${target.href}"
                                loading="eager"
                                decoding="sync"
                                    ></figure>`);
    },

    //  Called by: extracts.js (as `preparePopup_${targetTypeName}`)
    preparePopup_LOCAL_IMAGE: (popup) => {
        //  Mini title bar.
        popup.classList.add("mini-title-bar");

        return popup;
    },

    //  Called by: Extracts.rewritePopinContent_LOCAL_IMAGE
    //  Called by: Extracts.rewritePopupContent_LOCAL_IMAGE
    //  Called by: extracts.js (as `rewritePopFrameContent_${targetTypeName}`)
    rewritePopFrameContent_LOCAL_IMAGE: (popFrame) => {
        //  Remove extraneous classes from images in image pop-frames.
        popFrame.document.querySelector("img").classList.remove("link-page", "link-self",
            "has-annotation", "has-annotation-partial", "has-content");

		//	Loading spinner.
		Extracts.setLoadingSpinner(popFrame);

		//	We don’t need the full content inject handling, just ImageFocus.
		ImageFocus.processImagesWithin(popFrame.body);
    },

    //  Called by: extracts.js (as `rewritePopupContent_${targetTypeName}`)
    rewritePopinContent_LOCAL_IMAGE: (popin) => {
        Extracts.rewritePopFrameContent_LOCAL_IMAGE(popin);

        //  Remove extraneous classes from images in image popins.
        popin.document.querySelector("img").classList.remove("spawns-popin");
    },

    //  Called by: extracts.js (as `rewritePopinContent_${targetTypeName}`)
    rewritePopupContent_LOCAL_IMAGE: (popup) => {
        Extracts.rewritePopFrameContent_LOCAL_IMAGE(popup);

        //  Remove extraneous classes from images in image popups.
        popup.document.querySelector("img").classList.remove("spawns-popup");

        if (popup.document.querySelector("img[width][height]"))
        	Extracts.popFrameProvider.addClassesToPopFrame(popup, "dimensions-specified");
    },
};

/*=--------------------------=*/
/*= LOCALLY HOSTED DOCUMENTS =*/
/*=--------------------------=*/

Extracts.targetTypeDefinitions.insertBefore([
    "LOCAL_DOCUMENT",               // Type name
    "isLocalDocumentLink",          // Type predicate function
    "has-content",                  // Target classes to add
    "localDocumentForTarget",       // Pop-frame fill function
    "local-document object"         // Pop-frame classes
], (def => def[0] == "LOCAL_PAGE"));

Extracts = { ...Extracts,
    //  Called by: extracts.js (as `predicateFunctionName`)
    isLocalDocumentLink: (target) => {
        if (target.hostname != location.hostname)
            return false;

        return (   target.pathname.startsWith("/doc/www/")
                || (   target.pathname.startsWith("/doc/")
                    && target.pathname.match(/\.(html|pdf)$/i) != null));
    },

    //  Called by: extracts.js (as `popFrameFillFunctionName`)
    localDocumentForTarget: (target) => {
        GWLog("Extracts.localDocumentForTarget", "extracts-content.js", 2);

        return newDocument(Extracts.objectHTMLForURL(target,
            `sandbox="allow-same-origin" referrerpolicy="same-origin"`));
    },

    /*  This “special testing function” is used to exclude certain targets which
        have already been categorized as (in this case) `LOCAL_DOCUMENT`
        targets. It returns false if the target is to be excluded, true
        otherwise. Excluded targets will not spawn pop-frames.
     */
    //  Called by: extracts.js (as `testTarget_${targetTypeInfo.typeName}`)
    testTarget_LOCAL_DOCUMENT: (target) => {
    	/*	Mobile browsers have no in-browser PDF viewer, so a popin would be
    		pointless, since the file will download anyway.
    	 */
    	if (   Extracts.popFrameProvider == Popins
            && target.href.match(/\.pdf(#|$)/) != null)
            return false;

        return true;
    },

    //  Called by: extracts.js (as `rewritePopFrameContent_${targetTypeName}`)
    rewritePopFrameContent_LOCAL_DOCUMENT: (popFrame) => {
        let iframe = popFrame.document.querySelector("iframe");
        if (iframe) {
        	/*	All of this `srcURL` stuff is necessary as a workaround for a 
        		Chrome bug that scrolls the parent page when an iframe popup
        		has a `src` attribute with a hash and that hash points to an
        		old-style anchor (`<a name="foo">`).
        	 */
			let srcURL = new URL(iframe.src);
			if (   srcURL.pathname.endsWith(".html")
				&& srcURL.hash > "") {
				srcURL.savedHash = srcURL.hash;
				srcURL.hash = "";
				iframe.src = srcURL.href;
			}

            iframe.addEventListener("load", (event) => {
				if (srcURL.savedHash) {
					let selector = selectorFromHash(srcURL.savedHash);
					let element = iframe.contentDocument.querySelector(`${selector}, [name='${(selector.slice(1))}']`);
					if (element)
						iframe.contentWindow.scrollTo(0, element.getBoundingClientRect().y);
				}

				//  Set title of popup from page title.
				Extracts.updatePopFrameTitle(popFrame, iframe.contentDocument.title);
            });
        }

        //  Loading spinner.
        Extracts.setLoadingSpinner(popFrame);
    }
};

/*=-----------------------------=*/
/*= TRANSFORMED LOCAL DOCUMENTS =*/
/*=-----------------------------=*/

Extracts.targetTypeDefinitions.insertBefore([
    "LOCAL_DOCUMENT_TRANSFORM",          // Type name
    "isTransformableLocalDocumentLink",  // Type predicate function
    "has-content",                       // Target classes to add
    "localDocumentTransformForTarget",   // Pop-frame fill function
    "local-document-transform"           // Pop-frame classes
], (def => def[0] == "LOCAL_DOCUMENT"));

Extracts = { ...Extracts,
    //  Called by: extracts.js (as `predicateFunctionName`)
    isTransformableLocalDocumentLink: (target) => {
		if (target.classList.contains("content-transform-not"))
			return false;

		return Content.contentTypes.localTweetArchive.matches(target);
    },

    //  Called by: extracts.js (as `popFrameFillFunctionName`)
    localDocumentTransformForTarget: (target) => {
        GWLog("Extracts.localDocumentTransformForTarget", "extracts-content.js", 2);

        return newDocument(synthesizeIncludeLink(target));
    },

    //  Called by: extracts.js (as `titleForPopFrame_${targetTypeName}`)
    titleForPopFrame_LOCAL_DOCUMENT_TRANSFORM: (popFrame) => {
        GWLog("Extracts.titleForPopFrame_LOCAL_DOCUMENT_TRANSFORM", "extracts-annotations.js", 2);

        let target = popFrame.spawningTarget;
		let referenceData = Content.referenceDataForLink(target);
		if (referenceData == null) {
        	let originalURL = originalURLForLink(target);
			referenceData = {
				popFrameTitleLinkHref:  originalURL.href,
				popFrameTitleText:      `<code>${originalURL.href}</code>`
			};
		}

		return Transclude.fillTemplateNamed("pop-frame-title-annotation", referenceData, Extracts.getStandardPopFrameTitleTemplateFillContext());
    },

    //  Called by: extracts.js (as `rewritePopFrameContent_${targetTypeName}`)
    rewritePopFrameContent_LOCAL_DOCUMENT_TRANSFORM: (popFrame, injectEventInfo = null) => {
        let target = popFrame.spawningTarget;

		if (injectEventInfo == null) {
			GW.notificationCenter.addHandlerForEvent("GW.contentDidInject", (info) => {
				Extracts.rewritePopFrameContent_LOCAL_DOCUMENT_TRANSFORM(popFrame, info);
			}, {
				phase: "rewrite",
				condition: (info) => (   info.source == "transclude"
									  && info.document == popFrame.document),
				once: true
			});

			//	Trigger transcludes.
			Transclude.triggerTranscludesInContainer(popFrame.body, {
				source: "Extracts.rewritePopFrameContent_LOCAL_DOCUMENT_TRANSFORM",
				container: popFrame.body,
				document: popFrame.document,
				context: "popFrame"
			});

			return;
		}

		//	REAL REWRITES BEGIN HERE

		let referenceData = Content.referenceDataForLink(target);

        //  Add data source class.
        if (   referenceData
        	&& referenceData.content.dataSourceClass)
            Extracts.popFrameProvider.addClassesToPopFrame(popFrame, ...(referenceData.content.dataSourceClass.split(" ")));

		//	Update pop-frame title.
		Extracts.updatePopFrameTitle(popFrame);
	}
};

/*=---------------------------=*/
/*= LOCALLY HOSTED CODE FILES =*/
/*=---------------------------=*/

Extracts.targetTypeDefinitions.insertBefore([
    "LOCAL_CODE_FILE",              // Type name
    "isLocalCodeFileLink",          // Type predicate function
    "has-content",                  // Target classes to add
    "localCodeFileForTarget",       // Pop-frame fill function
    "local-code-file"               // Pop-frame classes
], (def => def[0] == "LOCAL_PAGE"));

Extracts = { ...Extracts,
    //  Called by: extracts.js (as `predicateFunctionName`)
    isLocalCodeFileLink: (target) => {
    	return Content.contentTypes.localCodeFile.matches(target);
    },

    //  Called by: extracts.js (as `popFrameFillFunctionName`)
    localCodeFileForTarget: (target) => {
        GWLog("Extracts.localCodeFileForTarget", "extracts-content.js", 2);

        return newDocument(synthesizeIncludeLink(target));
    },

    //  Called by: extracts.js (as `rewritePopFrameContent_${targetTypeName}`)
    rewritePopFrameContent_LOCAL_CODE_FILE: (popFrame, injectEventInfo = null) => {
        let target = popFrame.spawningTarget;

		if (injectEventInfo == null) {
			GW.notificationCenter.addHandlerForEvent("GW.contentDidInject", (info) => {
				Extracts.rewritePopFrameContent_LOCAL_CODE_FILE(popFrame, info);
			}, {
				phase: "rewrite",
				condition: (info) => (   info.source == "transclude"
									  && info.document == popFrame.document),
				once: true
			});

			//	Trigger transcludes.
			Transclude.triggerTranscludesInContainer(popFrame.body, {
				source: "Extracts.rewritePopFrameContent_LOCAL_CODE_FILE",
				container: popFrame.body,
				document: popFrame.document,
				context: "popFrame"
			});

			return;
		}

		//	REAL REWRITES BEGIN HERE

        //  Mark truncated code blocks, so layout can be adjusted properly.
        if (popFrame.body.lastElementChild.tagName == "P")
            popFrame.body.firstElementChild.classList.add("truncated");
    },
};

/*=----------------=*/
/*= OTHER WEBSITES =*/
/*=----------------=*/

Extracts.targetTypeDefinitions.insertBefore([
    "FOREIGN_SITE",             // Type name
    "isForeignSiteLink",        // Type predicate function
    "has-content",              // Target classes to add
    "foreignSiteForTarget",     // Pop-frame fill function
    "foreign-site object"       // Pop-frame classes
], (def => def[0] == "LOCAL_PAGE"));

Extracts = { ...Extracts,
    //  Called by: extracts.js (as `predicateFunctionName`)
    isForeignSiteLink: (target) => {
        if (target.hostname == location.hostname)
            return false;

        return target.classList.contains("link-live");
    },

    //  Used in: Extracts.foreignSiteForTarget
    foreignSiteEmbedURLTransforms: [
        //  Less Wrong
        [   (url) => [ "www.lesswrong.com", "lesswrong.com", "www.greaterwrong.com", "greaterwrong.com" ].includes(url.hostname),
            (url) => { Extracts.foreignSiteEmbedURLTransform_GreaterWrong(url, "www"); }
            ],
        //  Alignment Forum
        [   (url) => (   [ "www.alignmentforum.org", "alignmentforum.org" ].includes(url.hostname)
                      || (   [ "www.greaterwrong.com", "greaterwrong.com" ].includes(url.hostname)
                          && url.searchParams.get("view") == "alignment-forum")),
            (url) => { Extracts.foreignSiteEmbedURLTransform_GreaterWrong(url, "www", "view=alignment-forum"); }
            ],
        //  EA Forum
        [   (url) => [ "forum.effectivealtruism.org", "ea.greaterwrong.com" ].includes(url.hostname),
            (url) => { Extracts.foreignSiteEmbedURLTransform_GreaterWrong(url, "ea"); }
            ],
        //  Arbital
        [   (url) => [ "arbital.com", "arbital.greaterwrong.com" ].includes(url.hostname),
            (url) => { Extracts.foreignSiteEmbedURLTransform_GreaterWrong(url, "arbital"); }
            ],
		//	Twitter
		[	(url) => [ "twitter.com", "mobile.twitter.com" ].includes(url.hostname),
			(url) => { url.hostname = "nitter.moomoo.me"; }
			],
        //  Wikipedia
        [   (url) => /(.+?)\.wikipedia\.org/.test(url.hostname) == true,
            (url) => {
                url.hostname = url.hostname.replace(/(.+?)(?:\.m)?\.wikipedia\.org/, "$1.m.wikipedia.org");
                if (!url.hash)
                    url.hash = "#bodyContent";
            } ],
        //	Wikimedia commons
        [	(url) => (   url.hostname == "commons.wikimedia.org" 
        			  && url.pathname.startsWith("/wiki/File:")),
        	(url) => {
        		url.hostname = "api.wikimedia.org";
        		url.pathname = "/core/v1/commons/file/" + url.pathname.match(/\/(File:.+)$/)[1];
        	},
        	(url, target) => {
				doAjax({
					location: url.href,
					responseType: "json",
					onSuccess: (event) => {
						if (Extracts.popFrameProvider.isSpawned(target.popFrame) == false)
							return;

						Extracts.popFrameProvider.setPopFrameContent(target.popFrame, 
							newDocument(Extracts.objectHTMLForURL(event.target.response.original.url, "sandbox")));
						Extracts.setLoadingSpinner(target.popFrame);
					},
					onFailure: (event) => {
						Extracts.postRefreshUpdatePopFrameForTarget(target, false);
					}
				});

				return newDocument();
			} ]
    ],

    //  Used in: Extracts.foreignSiteEmbedURLTransforms
    foreignSiteEmbedURLTransform_GreaterWrong: (url, subdomain = "www", searchString = null) => {
        url.hostname = `${subdomain}.greaterwrong.com`;

		//	Ensure that comment permalinks display properly.
        if (url.searchParams.has("commentId")) {
        	url.pathname += `/comment/${(url.searchParams.get("commentId"))}`;
        	url.searchParams.delete("commentId");
        }

        url.search = (searchString
                      ? `${searchString}&`
                      : ``) +
                     "format=preview&theme=classic";
    },

    //  Called by: extracts.js (as `popFrameFillFunctionName`)
    foreignSiteForTarget: (target) => {
        GWLog("Extracts.foreignSiteForTarget", "extracts-content.js", 2);

        let url = new URL(target.href);

        //  WARNING: EXPERIMENTAL FEATURE!
        if (localStorage.getItem("enable-embed-proxy") == "true") {
            let proxyURL = new URL("https://api.obormot.net/embed.php");

            doAjax({
                location: proxyURL.href,
                params: { url: url.href },
                onSuccess: (event) => {
                    if (Extracts.popFrameProvider.isSpawned(target.popFrame) == false)
                        return;

                    let doc = newElement("DIV", null, { "innerHTML": event.target.responseText });
                    doc.querySelectorAll("[href], [src]").forEach(element => {
                        if (element.href) {
                            let elementURL = new URL(element.href);
                            if (   elementURL.host == location.host
                                && !element.getAttribute("href").startsWith("#")) {
                                elementURL.host = url.host;
                                element.href = elementURL.href;
                            }
                        } else if (element.src) {
                            let elementURL = new URL(element.src);
                            if (elementURL.host == location.host) {
                                elementURL.host = url.host;
                                element.src = elementURL.href;
                            }
                        }
                    });

                    if (event.target.getResponseHeader("content-type").startsWith("text/plain"))
                        doc.innerHTML = `<pre>${doc.innerHTML}</pre>`;

                    target.popFrame.document.querySelector("iframe").srcdoc = doc.innerHTML;

                    Extracts.postRefreshUpdatePopFrameForTarget(target, true);
                },
                onFailure: (event) => {
                    if (Extracts.popFrameProvider.isSpawned(target.popFrame) == false)
                        return;

                    Extracts.postRefreshUpdatePopFrameForTarget(target, false);
                }
            });

            return newDocument(`<iframe frameborder="0" sandbox="allow-scripts allow-popups"></iframe>`);
        }
        //  END EXPERIMENTAL SECTION

        //  Transform URL for embedding.
        /*  NOTE: the protocol *must* be https, not http; attempting to load
            http URLs from a page loaded over https, even in a shadow-root, will
            fail with a “Mixed Content” error. This way, we force https, in the
            hopes that the foreign site supports TLS, despite that the URL we’ve
            got is http. Unfortunately, some sites do not in fact support TLS;
            those sites will fail to load. This is unavoidable, and means that
            such sites cannot be live-embedded.
         */
        url.protocol = "https:";
        for ([ test, transform, special ] of Extracts.foreignSiteEmbedURLTransforms) {
            if (test(url)) {
            	if (transform) {
            		transform(url);
            	}
            	if (special) {
            		let retval = special(url, target);
            		if (retval)
            			return retval;
            	}
                break;
            }
        }

        return newDocument(Extracts.objectHTMLForURL(url, "sandbox"));
    },

    //  Called by: extracts.js (as `rewritePopFrameContent_${targetTypeName}`)
    rewritePopFrameContent_FOREIGN_SITE: (popFrame) => {
        //  Loading spinner.
        Extracts.setLoadingSpinner(popFrame);
    }
};

/*=------------------=*/
/*= CONTENT: HELPERS =*/
/*=------------------=*/

Extracts = { ...Extracts,
    //  Called by: Extracts.videoForTarget
    //  Called by: Extracts.localDocumentForTarget
    //  Called by: Extracts.foreignSiteForTarget
    objectHTMLForURL: (url, additionalAttributes = null) => {
		if (typeof url == "string")
			url = new URL(url);

        if (url.href.match(/\.pdf(#|$)/) != null) {
            let data = url.href + (url.hash ? "&" : "#") + "view=FitH";
            return `<object
                        data="${data}"
                            ></object>`;
        } else {
            return `<iframe
                        src="${url.href}"
                        frameborder="0"
                        ${(additionalAttributes ? (" " + additionalAttributes) : "")}
                            ></iframe>`;
        }
    },

	//	Used in: Extracts.setUpContentLoadEventsWithin
	contentLoadHoverDelay: 25,

    //  Called by: extracts.js
    setUpContentLoadEventsWithin: (container) => {
        GWLog("Extracts.setUpContentLoadEventsWithin", "extracts.js", 1);

        /*  Get all targets in the container that use Content as a data loading
        	provider. (Currently that is local page links, local fragment links,
        	and local code file links.)
         */
        let allTargetsInContainer = Array.from(container.querySelectorAll("a[class*='has-content']")).filter(link =>
        	Content.contentTypeForLink(link) != null
        );

        if (Extracts.popFrameProvider == Popups) {
            //  Add hover event listeners to all the chosen targets.
            allTargetsInContainer.forEach(target => {
                target.removeContentLoadEvents = onEventAfterDelayDo(target, "mouseenter", Extracts.contentLoadHoverDelay, (event) => {
                    //  Do nothing if the content is already loaded.
                    if (Content.cachedDataExists(target) == false)
                        Content.load(target);
                }, "mouseleave");
            });

			if (allTargetsInContainer.length > 0) {
				/*  Set up handler to remove hover event listeners from all
					the chosen targets in the document.
					*/
				GW.notificationCenter.addHandlerForEvent("Extracts.cleanupDidComplete", (info) => {
					allTargetsInContainer.forEach(target => {
						target.removeContentLoadEvents();
						target.removeContentLoadEvents = null;
					});
				}, { once: true });
            }
        } else { // if (Extracts.popFrameProvider == Popins)
            //  Add click event listeners to all the chosen targets.
            allTargetsInContainer.forEach(target => {
                target.addEventListener("click", target.contentLoad_click = (event) => {
                    //  Do nothing if the content is already loaded.
                    if (Content.cachedDataExists(target) == false)
                        Content.load(target);
                });
            });

            /*  Set up handler to remove click event listeners from all
                the annotated targets in the document.
                */
            GW.notificationCenter.addHandlerForEvent("Extracts.cleanupDidComplete", (info) => {
                allTargetsInContainer.forEach(target => {
                    target.removeEventListener("click", target.contentLoad_click);
                });
            }, { once: true });
        }
    },
};
