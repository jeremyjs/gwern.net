document.querySelector("head").insertAdjacentHTML("beforeend", "<style>" + `
#popupdiv {
    z-index: 10001;
    font-size: 0.8em;
    box-shadow: 0 0 0 2px #fff;
    position: absolute;
    opacity: 1.0;
    transition: none;
}
#popupdiv.fading {
    opacity: 0.0;
    transition:
        opacity 0.75s ease-in 0.1s;
}

#popupdiv > div {
    background-color: #fff;
    padding: 12px 16px 14px 16px;
    max-width: 600px;
    max-height: calc(100vh - 32px);
    border: 3px double #aaa;
    line-height: 1.45;
    overflow: auto;
    overscroll-behavior: none;
}

/*  Scroll bar styles (Webkit/Blink only).
    */
#popupdiv > div::-webkit-scrollbar {
    width: 14px;
}
#popupdiv > div::-webkit-scrollbar-thumb {
    background-color: #ccc;
    box-shadow:
        0 0 0 3px #fff inset;
}
#popupdiv > div::-webkit-scrollbar-thumb:hover {
    background-color: #999;
}

@media only screen and (max-width: 64.9ch), not screen and (hover:hover) and (pointer:fine) {
    #popupdiv {
        display: none;
    }
}
` + "</style>");

Extracts = {
	contentContainerSelector: "#markdownBody",
	targetElementsSelector: "#markdownBody a[href*='wikipedia.org/wiki/']",
	minPopupWidth: 480,
	popupfadetimeout: false,
	popupkilltimeout: false,
	popuptimeout: false,
	popup: null,
	unbind: function() {
		document.querySelectorAll(Extracts.targetElementsSelector).forEach(target => {
			//	Unbind existing mouseover/mouseout events, if any.
			target.removeEventListener("mouseover", Extracts.targetover);
			target.removeEventListener("mouseout", Extracts.targetout);
		});
	},
	setup: function() {
		//	Get or generate contents of the popups.
		document.querySelectorAll("#markdownBody a[href*='wikipedia.org/wiki/']").forEach(wikilink => {
			let wikipage = /https:\/\/en\.wikipedia\.org\/wiki\/(.+)/.exec(wikilink.href)[1];

			let req = new XMLHttpRequest();
			req.addEventListener("load", (event) => {
				if (event.target.status >= 400) {
					console.log("FAIL");
					return;
				}
				wikilink.dataset.summary = JSON.parse(event.target.response).extract_html;
				wikilink.dataset.summaryLabel = wikilink.title;
				wikilink.removeAttribute("title");
			});
			req.open("GET", `https://en.wikipedia.org/api/rest_v1/page/summary/${wikipage}`);
			req.send();
		});

		Extracts.unbind();
		//	Get all targets.
		document.querySelectorAll(Extracts.targetElementsSelector).forEach(target => {
			//	Bind mousemover/mouseout events.
			target.addEventListener("mouseover", Extracts.targetover);
			target.addEventListener("mouseout", Extracts.targetout);
		});
	},
	//	The mouseover event.
	targetover: (event) => {
		//	Stop the countdown to un-pop the popup.
		clearTimeout(Extracts.popupfadetimeout);
		clearTimeout(Extracts.popupkilltimeout);
		clearTimeout(Extracts.popuptimeout);

		Extracts.popuptimeout = setTimeout(() => {
			//	Get the target.
			let target = event.target.closest("a");
			var targetAbsoluteRect = target.getBoundingClientRect();
			let layoutParentSelector = matchMedia("(max-width: 176ch)").matches ? "main" : "#markdownBody";
			let layoutParent = document.querySelector(layoutParentSelector);
			let layoutParentAbsoluteRect = layoutParent.getBoundingClientRect();
			var targetPosition = {
				left: (targetAbsoluteRect.left - layoutParentAbsoluteRect.left),
				top: (targetAbsoluteRect.top - layoutParentAbsoluteRect.top)
			};

			//	Get, or create, the popup.
			Extracts.popup = document.querySelector("#popupdiv");
			if (Extracts.popup) {
				Extracts.popup.classList.remove("fading");
				Extracts.popup.remove();
			} else {
				Extracts.popup = document.createElement('div');
				Extracts.popup.id = "popupdiv";
			}

			//	Inject the contents of the popup into the popup div.
			Extracts.popup.innerHTML = `<div>${target.dataset.summary}</div>`;

			//	Inject the popup into the page.
			document.querySelector(Extracts.contentContainerSelector).appendChild(Extracts.popup);

			//	Add event listeners.
			Extracts.popup.addEventListener("mouseover", Extracts.divover);
			Extracts.popup.addEventListener("mouseout", Extracts.targetout);

			/*	How much “breathing room” to give the target (i.e., offset of
				the popup).
				*/
			var popupBreathingRoom = {
				x:	(Math.round(targetAbsoluteRect.height) * 1.25),
				y:	(Math.round(targetAbsoluteRect.height) * 1.25)
			};

			/*	Set the horizontal position first; this causes the popup to be
				laid out, and the layout engine calculates the height for us.
				*/
			var popupLeft = targetPosition.left;
			if (popupLeft + Extracts.minPopupWidth > layoutParentAbsoluteRect.width)
				popupLeft = layoutParentAbsoluteRect.width - Extracts.minPopupWidth;
			Extracts.popup.style.left = popupLeft + "px";
			//	Correct for various positioning aberrations.
// 			if (Extracts.popup.getBoundingClientRect().right > layoutParentAbsoluteRect.width)
// 				Extracts.popup.style.maxWidth = (Extracts.popup.clientWidth - (Extracts.popup.getBoundingClientRect().right - layoutParentAbsoluteRect.width) - parseInt(getComputedStyle(Extracts.popup.firstElementChild).paddingRight)) + "px";
// 			else if (targetPosition.left + Extracts.popup.clientWidth < layoutParentAbsoluteRect.width)
// 				Extracts.popup.style.left = (targetPosition.left) + "px";
// 			else if (targetPosition.left - (Extracts.popup.clientWidth) > Extracts.popup.getBoundingClientRect().left)
// 				Extracts.popup.style.left = (targetPosition.left - Extracts.popup.clientWidth) + "px";

			//	Now we know how tall the popup is...
			var provisionalExtractPopupHeight = Extracts.popup.clientHeight;

			//	Determining vertical position is full of edge cases.
			var popupTop = targetPosition.top + popupBreathingRoom.y;
			if (popupTop + provisionalExtractPopupHeight > window.innerHeight + window.scrollY - layoutParent.offsetTop) {
				popupTop -= (provisionalExtractPopupHeight + popupBreathingRoom.y);
			}
			if (top + provisionalExtractPopupHeight > window.innerHeight + window.scrollY ||
				provisionalExtractPopupHeight == window.innerHeight ||
				popupTop < window.scrollY - layoutParent.offsetTop) {
				console.log(layoutParentAbsoluteRect);
				popupTop = window.scrollY - layoutParent.offsetTop;
			}
			if (popupTop + provisionalExtractPopupHeight + 120 < targetPosition.top) {
				popupTop = targetPosition.top - provisionalExtractPopupHeight;
			} else if (top > targetPosition.top) {
				popupTop -= 90;
			}
			if (popupTop < 0) {
				popupTop = 0;
			}
			Extracts.popup.style.top = popupTop + "px";
		}, 50);
	},
	//	The mouseout event.
	targetout: (event) => {
		clearTimeout(Extracts.popupfadetimeout);
		clearTimeout(Extracts.popupkilltimeout);
		clearTimeout(Extracts.popuptimeout);

		if (!Extracts.popup) return;

		Extracts.popupfadetimeout = setTimeout(() => {
			Extracts.popup.classList.add("fading");
			Extracts.popupkilltimeout = setTimeout(() => {
				Extracts.popup.classList.remove("fading");
				Extracts.popup.remove();
			}, 750);
		}, 100);
	},
	//	The “user moved mouse back into popup” mouseover event.
	divover: (event) => {
		clearTimeout(Extracts.popupfadetimeout);
		clearTimeout(Extracts.popupkilltimeout);
		clearTimeout(Extracts.popuptimeout);
		Extracts.popup.classList.remove("fading");
	}
}

if (document.readyState == "complete") {
	Extracts.setup();
} else {
	window.addEventListener("load", Extracts.setup);
}
