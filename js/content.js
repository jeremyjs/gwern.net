Content = {
	/*******************/
	/*	Content caching.
	 */

	cachedContent: { },

	contentCacheKeyForLink: (link) => {
		return Content.sourceURLsForLink(link).first.href;
	},

	cacheContentForLink: (content, link) => {
		Content.cachedContent[Content.contentCacheKeyForLink(link)] = content;
	},

	cachedContentForLink: (link) => {
		//	Special case for the link being to the current page.
		if (link.pathname == location.pathname)
			Content.load(link);

		return Content.cachedContent[Content.contentCacheKeyForLink(link)];
	},

	cachedDocumentForLink: (link) => {
		let content = Content.cachedContentForLink(link);
		return (content && content != "LOADING_FAILED"
				? content.document 
				: null);
	},

	cachedDataExists: (link) => {
		let cachedContent = Content.cachedContentForLink(link);
        return (   cachedContent != null
        		&& cachedContent != "LOADING_FAILED");
	},

	updateCachedContent: (link, updateFunction) => {
		if (Content.cachedDataExists(link) == false)
			return;

		let content = Content.cachedContentForLink(link);

		switch (Content.contentTypeForLink(link)) {
			case Content.contentTypes.localPage:
				updateFunction(content.document);
				break;
			default:
				break;
		}
	},

	/*******************/
	/*	Content loading.
	 */

	sourceURLsForLink: (link) => {
		return Content.contentTypeForLink(link).sourceURLsForLink(link);
	},

	//	Called by: Extracts.handleIncompleteReferenceData (extracts.js)
	waitForDataLoad: (link, loadHandler = null, loadFailHandler = null) => {
		if (Content.cachedContentForLink(link) == "LOADING_FAILED") {
            if (loadFailHandler)
            	loadFailHandler(link);

			return;
		} else if (Content.cachedContentForLink(link)) {
            if (loadHandler)
            	loadHandler(link);

			return;
		}

		let didLoadHandler = (info) => {
            if (loadHandler)
            	loadHandler(link);

			GW.notificationCenter.removeHandlerForEvent("Content.contentLoadDidFail", loadDidFailHandler);
        };
        let loadDidFailHandler = (info) => {
            if (loadFailHandler)
            	loadFailHandler(link);

			GW.notificationCenter.removeHandlerForEvent("Content.contentDidLoad", didLoadHandler);
        };
		let options = {
        	once: true,
        	condition: (info) => (info.link == link)
        };

        GW.notificationCenter.addHandlerForEvent("Content.contentDidLoad", didLoadHandler, options);
        GW.notificationCenter.addHandlerForEvent("Content.contentLoadDidFail", loadDidFailHandler, options);
	},

	load: (link, loadHandler = null, loadFailHandler = null, sourceURLsRemaining = null) => {
        GWLog("Content.load", "content.js", 2);

		sourceURLsRemaining = sourceURLsRemaining ?? Content.sourceURLsForLink(link);
		let sourceURL = sourceURLsRemaining.shift();

		let processResponse = (response) => {
			let content = Content.contentFromResponse(response, link, sourceURL);

			if (content) {
				Content.cacheContentForLink(content, link);

				GW.notificationCenter.fireEvent("Content.contentDidLoad", {
					link: link
				});
			} else {
				Content.cacheContentForLink("LOADING_FAILED", link);

				GW.notificationCenter.fireEvent("Content.contentLoadDidFail", {
					link: link
				});

				//	Send request to record failure in server logs.
				GWServerLogError(sourceURL + `--could-not-process`, "problematic content");
			}
		};

		if (sourceURL.pathname == location.pathname) {
			processResponse();
		} else {
			doAjax({
				location: sourceURL.href,
				onSuccess: (event) => {
					let contentType = Content.contentTypeForLink(link);
					let httpContentTypeHeader = event.target.getResponseHeader("Content-Type");
					if (   contentType.permittedContentTypes
						&& (   httpContentTypeHeader == null
							|| contentType.permittedContentTypes.includes(httpContentTypeHeader.match(/(.+?)(?:;|$)/)[1]) == false)) {
						//	Send request to record failure in server logs.
						GWServerLogError(includeLink.href + `--bad-content-type`, "bad content type");

						return;
                    }

					processResponse(event.target.responseText);
				},
				onFailure: (event) => {
					if (sourceURLsRemaining.length > 0) {
						Content.load(link, null, null, sourceURLsRemaining);
						return;
					}

					Content.cacheContentForLink("LOADING_FAILED", link);

					GW.notificationCenter.fireEvent("Content.contentLoadDidFail", {
						link: link
					});

					//	Send request to record failure in server logs.
					GWServerLogError(sourceURL, "missing content");
				}
			});
		}

		//	Call any provided handlers, if/when appropriate.
		if (loadHandler || loadFailHandler)
			Content.waitForDataLoad(link, loadHandler, loadFailHandler);
	},

	contentFromResponse: (response, link, loadURL) => {
		return Content.contentTypeForLink(link).contentFromResponse(response, link, loadURL);
	},

	/****************************/
	/*	Reference data retrieval.
	 */

	referenceDataForLink: (link) => {
		let content = Content.cachedContentForLink(link);
		if (   content == null
			|| content == "LOADING_FAILED") {
			return content;
		} else {
			return Content.referenceDataFromContent(content, link);
		}
	},

	referenceDataFromContent: (content, link) => {
		return Content.contentTypeForLink(link).referenceDataFromContent(content, link);
	},

	/**************************************************************/
	/*	CONTENT TYPES

		Each has four necessary members:

		.matches(URL|Element) => boolean
		.sourceURLsForLink(URL|Element) => [ URL ]
		.contentFromResponse(string, URL|Element, URL) => object
		.referenceDataFromContent(object, URL|Element) => object
	 */

	contentTypeForLink: (link) => {
		for ([ typeName, contentType ] of Object.entries(Content.contentTypes))
			if (contentType.matches(link))
				return contentType;

		return null;
	},

	contentTypes: {
		localTweetArchive: {
			matches: (link) => {
				let originalURL = originalURLForLink(link);
				return (   link.hostname == location.hostname
						&& link.pathname.startsWith("/doc/www/")
						&& originalURL.hostname == "twitter.com"
						&& originalURL.pathname.match(/\/.+?\/status\/[0-9]+$/));
			},

			sourceURLsForLink: (link) => {
				let url = new URL(link.href);
				url.hash = "";
				url.search = "";

				return [ url ];
			},

			contentFromResponse: (response, link = null, loadURL) => {
				return {
					document: newDocument(response)
				};
			},

			referenceDataFromContent: (tweetPage, link) => {
				//	Link metadata for title-links.
				let titleLinkClass = "title-link link-live content-transform-not";
				let titleLinkIconMetadata = `data-link-icon-type="svg" data-link-icon="twitter"`;

				let nitterHost = Content.contentTypes.localTweetArchive.getNitterHost();

				//	URL for link to user’s page.
				let titleLinkURL = new URL(tweetPage.document.querySelector(".main-tweet a.username").href);
				titleLinkURL.hostname = nitterHost;
				let titleLinkHref = titleLinkURL.href;

				//	Text of link to user’s page.
				let titleText = tweetPage.document.querySelector("title").textContent.match(/^(.+?):/)[1];
				let titleHTML = titleText.replace(/\((@.+?)\)/, "(<code>$1</code>)");

				//	Link to tweet.
				let tweetDate = new Date(Date.parse(tweetPage.document.querySelector(".main-tweet .tweet-date").textContent));
				let tweetDateString = `${tweetDate.getFullYear()}-${tweetDate.getMonth()}-${tweetDate.getDate()}`;
				let tweetLinkURL = originalURLForLink(link);
				tweetLinkURL.hostname = nitterHost;
				tweetLinkURL.hash = "m";
				let secondaryTitleLinksHTML = ` on <a href="${tweetLinkURL.href}" class="${titleLinkClass}" ${titleLinkIconMetadata}>${tweetDateString}</a>:`;

				//	Tweet content itself.
				let tweetContent = tweetPage.document.querySelector(".main-tweet .tweet-content").innerHTML.split("\n\n").map(graf => `<p>${graf}</p>`).join("\n");

				//	Attached media (video or images).
				tweetContent += Content.contentTypes.localTweetArchive.mediaEmbedHTML(tweetPage.document);

				//	Pop-frame title text.
				let popFrameTitleText = `${titleHTML} on ${tweetDateString}`;

				return {
					content: {
						titleHTML:                titleHTML,
						fullTitleHTML:            titleHTML,
						titleText:                titleText,
						titleLinkHref:            titleLinkHref,
						titleLinkClass:           titleLinkClass,
						titleLinkIconMetadata:    titleLinkIconMetadata,
						secondaryTitleLinksHTML:  secondaryTitleLinksHTML,
						abstract: 		          tweetContent,
						dataSourceClass:          "tweet",
					},
					template:                       "annotation-blockquote-not",
					linkTarget:                     (GW.isMobile() ? "_self" : "_blank"),
					whichTab:                       (GW.isMobile() ? "current" : "new"),
					tabOrWindow:                    (GW.isMobile() ? "tab" : "window"),
					popFrameTitleText:              popFrameTitleText,
					popFrameTitleLinkHref:          tweetLinkURL.href
				};
			},

			mediaURLFromMetaTag: (mediaMetaTag, nitterHost) => {
				let mediaURL = mediaMetaTag.content.startsWith("/")
							   ? new URL(location.origin + mediaMetaTag.content)
							   : new URL(mediaMetaTag.content);
				mediaURL.hostname = nitterHost;
				return mediaURL;
			},

			mediaEmbedHTML: (response) => {
				let nitterHost = Content.contentTypes.localTweetArchive.getNitterHost();

				let imageMetaTagSelector = "meta[property='og:image']";
				let videoMetaTagSelector = "meta[property='og:video:url']";

				let videoMetaTag = response.querySelector(videoMetaTagSelector);
				if (videoMetaTag) {
					let videoURL = Content.contentTypes.localTweetArchive.mediaURLFromMetaTag(videoMetaTag, nitterHost);
					let imageMetaTag = response.querySelector(imageMetaTagSelector);
					let imageURL = Content.contentTypes.localTweetArchive.mediaURLFromMetaTag(imageMetaTag, nitterHost);
					return (  `<figure>`
							+ `<video controls="controls" preload="none" poster="${imageURL.href}">`
							+ `<source src="${videoURL.href}">`
							+ `</video></figure>`);
				}

				let imageMetaTags = response.querySelectorAll(imageMetaTagSelector);
				if (imageMetaTags.length > 0) {
					return Array.from(imageMetaTags).map(tag => 
							`<img src="${(Content.contentTypes.localTweetArchive.mediaURLFromMetaTag(tag, nitterHost).href)}" loading="lazy">`
						  ).join("");
				}

				return ``;
			},

			liveNitterHosts: [
				"nitter.moomoo.me"
			],

			getNitterHost: () => {
				let hosts = Content.contentTypes.localTweetArchive.liveNitterHosts;
				return hosts[rollDie(hosts.length) - 1];
			}
		},

		localCodeFile: {
			matches: (link) => {
				//	Maybe it’s a foreign link?
				if (link.hostname != location.hostname)
					return false;

				//	Maybe it’s an annotated link?
				if (Annotations.isAnnotatedLinkFull(link))
					return false;

				//	Maybe it’s an aux-links link?
				if (link.pathname.startsWith("/metadata/"))
					return false;

				//	Maybe it’s a local document link?
				if (   link.pathname.startsWith("/doc/www/")
                	|| (   link.pathname.startsWith("/doc/")
                		&& link.pathname.match(/\.(html|pdf)$/i) != null))
                	return false;

				let codeFileURLRegExp = new RegExp(
					  '\\.('
					+ Content.contentTypes.localCodeFile.codeFileExtensions.join("|")
					+ ')$'
				, 'i');
				return codeFileURLRegExp.test(link.pathname);
			},

			/*  We first try to retrieve a syntax-highlighted version of the
				given code file, stored on the server as an HTML fragment. If
				present, we embed that. If there’s no such fragment, then we
				just embed the contents of the actual code file, in a
				<pre>-wrapped <code> element.
			 */
			sourceURLsForLink: (link) => {
				let codeFileURL = new URL(link.href);
				codeFileURL.hash = "";
				codeFileURL.search = "";

				let syntaxHighlightedCodeFileURL = new URL(codeFileURL.href);
				syntaxHighlightedCodeFileURL.pathname += ".html";

				return [ syntaxHighlightedCodeFileURL, codeFileURL ];
			},

			contentFromResponse: (response, link = null, loadURL) => {
				let codeDocument;

				//	Parse (encoding and wrapping first, if need be).
				if (response.slice(0, 1) == "<") {
					//	Syntax-highlighted code (already HTML-encoded).
					codeDocument = newDocument(response);
				} else {
					//	“Raw” code.
					let htmlEncodedResponse = response.replace(
						/[<>]/g,
						c => ('&#' + c.charCodeAt(0) + ';')
					);
					codeDocument = newDocument(  `<pre class="raw-code"><code>`
											   + htmlEncodedResponse
											   + `</code></pre>`);
				}

				//	Inject line spans.
				let codeBlock = codeDocument.querySelector("code");
				codeBlock.innerHTML = codeBlock.innerHTML.split("\n").map(
					line => (`<span class="line">${(line || "&nbsp;")}</span>`)
				).join("\n");

				return {
					document: codeDocument
				};
			},

			referenceDataFromContent: (codePage, link = null) => {
				return {
					content: codePage.document
				};
			},

			codeFileExtensions: [
				//	Truncated at 1000 lines for preview.
				"bash", "c", "conf", "css", "csv", "diff", "hs", "html", "js",
				"json", "jsonl", "opml", "page", "patch", "php", "py", "R",
				"sh", "xml", "yaml",
				//	Non-syntax highlighted (due to lack of known format), but truncated:
				"txt"
			]
		},

		localFragment: {
			matches: (link) => {
				//	Maybe it’s a foreign link?
				if (link.hostname != location.hostname)
					return false;

				//	Maybe it’s an annotated link?
				if (Annotations.isAnnotatedLinkFull(link))
					return false;

				return (   link.pathname.startsWith("/metadata/")
						&& link.pathname.endsWith(".html"));
			},

			sourceURLsForLink: (link) => {
				let url = new URL(link.href);
				url.hash = "";
				url.search = "";

				return [ url ];
			},

			contentFromResponse: (response, link = null, loadURL) => {
				let fragment = newDocument(response);

				let auxLinksLinkType = AuxLinks.auxLinksLinkType(loadURL);
				if (auxLinksLinkType) {
					let auxLinksList = fragment.querySelector("ul, ol");
					if (auxLinksList) {
						auxLinksList.classList.add("aux-links-list", auxLinksLinkType + "-list");
						auxLinksList.previousElementSibling.classList.add("aux-links-list-label", auxLinksLinkType + "-list-label");

						if (auxLinksLinkType == "backlinks") {
							auxLinksList.querySelectorAll("blockquote").forEach(blockquote => {
								blockquote.classList.add("backlink-context");
							});
							auxLinksList.querySelectorAll("li > p").forEach(p => {
								p.classList.add("backlink-source");
							});
							auxLinksList.querySelectorAll(".backlink-source a:nth-of-type(2), .backlink-context a").forEach(auxLink => {
								auxLink.dataset.backlinkTargetUrl = AuxLinks.targetOfAuxLinksLink(loadURL);
							});
						}
					}
				}

				//  Fire contentDidLoad event, if need be.
				GW.notificationCenter.fireEvent("GW.contentDidLoad", {
					source: "Content.contentTypes.localFragment.load",
					container: fragment,
					document: fragment,
					loadLocation: link
				});

				return {
					document: fragment
				};
			},

			referenceDataFromContent: (fragment, link = null) => {
				return {
					content: fragment.document
				};
			},

		    permittedContentTypes: [ "text/html" ]
		},

		localPage: {
			matches: (link) => {
				//	Maybe it’s a foreign link?
				if (link.hostname != location.hostname)
					return false;

				//	Maybe it’s an annotated link?
				if (Annotations.isAnnotatedLinkFull(link))
					return false;

				/*  If it has a period in it, it’s probably not a page, but is 
					something else, like a file of some sort, or a locally 
					archived document. Still, we allow for explicit overrides.
				 */
				return (   link.pathname.match(/\./) == null
						|| link.pathname.endsWith("/index")
						|| link.classList.contains("link-page"));
			},

			sourceURLsForLink: (link) => {
				let url = new URL(link.href);
				url.hash = "";
				url.search = "";

				return [ url ];
			},

			contentFromResponse: (response, link = null, loadURL) => {
				let page = response
						   ? newDocument(response)
						   : document;

				if (response)
					page.baseLocation = loadURL;

				//	Get the body classes.
				let pageBodyClasses = page.querySelector("meta[name='page-body-classes']").getAttribute("content").trim().split(" ");

				//  Get the page title.
				let pageTitle = page.querySelector("title").innerHTML.match(Content.contentTypes.localPage.pageTitleRegexp)[1];

				//	Get the page thumbnail URL and metadata.
				let pageThumbnailHTML;
				let pageThumbnailMetaTag = page.querySelector("meta[property='og:image']");
				if (pageThumbnailMetaTag) {
					let pageThumbnailURL = new URL(pageThumbnailMetaTag.getAttribute("content"));

					//	Alt text, if provided.
					let pageThumbnailAltMetaTag = page.querySelector("meta[property='og:image:alt']");
					let pageThumbnailAltText = (pageThumbnailAltMetaTag
												? pageThumbnailAltMetaTag.getAttribute("content")
												: `Thumbnail image for “${pageTitle}”`
												).replace(/"/g, "&quot;");

					//	Image dimensions.
					let pageThumbnailWidth = page.querySelector("meta[property='og:image:width']").getAttribute("content");
					let pageThumbnailHeight = page.querySelector("meta[property='og:image:height']").getAttribute("content");

					//	Construct and save the <img> tag.
					if (pageThumbnailURL.pathname.startsWith(Content.contentTypes.localPage.defaultPageThumbnailPathnamePrefix) == false)
						pageThumbnailHTML = `<img
							src="${pageThumbnailURL.href}"
							title="${pageThumbnailAltText}"
							width="${pageThumbnailWidth}"
							height="${pageThumbnailHeight}"
							style="width: ${pageThumbnailWidth}px; height: auto;"
								>`;

					//	Request the image, to cache it.
					doAjax({ location: pageThumbnailURL.href });
				}

				if (response) {
					//  Fire contentDidLoad event, if need be.
					GW.notificationCenter.fireEvent("GW.contentDidLoad", {
						source: "Content.contentTypes.localPage.load",
						container: page,
						document: page,
						loadLocation: loadURL
					});
				}

				return {
					title:          pageTitle,
					bodyClasses:    pageBodyClasses,
					thumbnailHTML:  pageThumbnailHTML,
					document:       page
				};
			},

			referenceDataFromContent: (page, link) => {
				//  The page content is the page body plus the metadata block.
				let pageContent = newDocument();
				//	Add the page metadata block.
				let pageMetadataBlock = page.document.querySelector("#page-metadata");
				if (pageMetadataBlock) {
					pageContent.append(newDocument(pageMetadataBlock));

					pageMetadataBlock = pageContent.querySelector("#page-metadata");
					pageMetadataBlock.classList.remove("markdownBody");
					if (pageMetadataBlock.className == "")
						pageMetadataBlock.removeAttribute("class");
				}
				//	Add the page main content block.
				pageContent.append(newDocument(page.document.querySelector("#markdownBody").childNodes));

				//	Find the target element and/or containing block, if any.
				let element = targetElementInDocument(link, pageContent);

				//	Pop-frame title text.
				let popFrameTitleTextParts = [ ];
				if (link.pathname != location.pathname)
					popFrameTitleTextParts.push(page.title);

				//	Section title or block id.
				if (element) {
					let nearestSection = element.closest("section");
					let nearestFootnote = element.closest("li.footnote");
					if (nearestFootnote) {
						popFrameTitleTextParts.push("Footnote", Notes.noteNumber(nearestFootnote));
						let identifyingSpan = nearestFootnote.querySelector("span[id]:empty");
						if (identifyingSpan)
							popFrameTitleTextParts.push(`(#${(identifyingSpan.id)})`);
					} else if (nearestSection) {
						//	Section mark (§) for sections.
						popFrameTitleTextParts.push("&#x00a7;");
						if (nearestSection.id == "footnotes") {
							popFrameTitleTextParts.push("Footnotes");
						} else {
							popFrameTitleTextParts.push(nearestSection.firstElementChild.textContent);
						}
					} else {
						popFrameTitleTextParts.push(link.hash);
					}
				}

				return {
					content:                 pageContent,
					pageTitle:               page.title,
					pageBodyClasses:         page.bodyClasses,
					pageThumbnailHTML:       page.thumbnailHTML,
					popFrameTitleLinkHref:   link.href,
					popFrameTitleText:       popFrameTitleTextParts.join(" "),
					popFrameTitleTextShort:  popFrameTitleTextParts.first
				}
			},

		    permittedContentTypes: [ "text/html" ],
			pageTitleRegexp: /^(.+?) · Gwern\.net( \(reader mode\))?$/,
			defaultPageThumbnailPathnamePrefix: "/static/img/logo/logo-"
		}
	}
};
