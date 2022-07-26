/*	This code is part of dark-mode.js by Said Achmiz.
	See the file `dark-mode.js` for license and more information.
 */

/*	Dark mode: before anything else loads, check browser localStorage for dark 
	mode preference and immediately toggle sets of CSS color variables/classes 
	to avoid any ‘flash of white’ or delayed loading. Note: CSS falls back to 
	the media-query browser/OS variable preference, so still works if JS is 
	blocked! (The JS is only necessary for the theme switcher widget allowing 
	‘force light’/‘force dark’ options. If users block JS, set the dark mode 
	preference, and are unhappy when they get dark mode, well, they made their 
	bed and must lie in it.)
 */

DarkMode = {
	/*  Set specified color mode (auto, light, dark).

		Called by: this file (immediately upon load)
		Called by: DarkMode.modeSelectButtonClicked (dark-mode.js)
	 */
	setMode: (selectedMode = DarkMode.currentMode()) => {
		GWLog("DarkMode.setMode", "dark-mode.js", 1);

		//	The style block should be inlined (and already loaded).
		let darkModeStyles = document.querySelector("#inlined-dark-mode-styles");
		if (darkModeStyles == null)
			return;

		//	Set `media` attribute of style block to match requested mode.
		if (selectedMode == 'auto') {
			darkModeStyles.media = "all and (prefers-color-scheme: dark)";
		} else if (selectedMode == 'dark') {
			darkModeStyles.media = "all";
		} else {
			darkModeStyles.media = "not all";
		}

		//	Fire event.
		GW.notificationCenter.fireEvent("DarkMode.didSetMode");
	},

    /*  Returns current (saved) mode (light, dark, or auto).
     */
    currentMode: () => {
    	//	Remove the `selected-mode` part when enough time has passed.
    	//	—SA 2022-07-23
        return (localStorage.getItem("dark-mode-setting") || localStorage.getItem("selected-mode") || "auto");
    },
};

//	Activate saved mode.
DarkMode.setMode();