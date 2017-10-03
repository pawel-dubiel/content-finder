const jsdom = require("jsdom");
const { JSDOM } = jsdom;
const DEBUG = false;

var dbg = function (s) {
    if (DEBUG) {
            console.log("Readability: " + s);
    }
};


/**
 *  Adapted from Readability An Arc90 Lab Experiment. 
 *
 *  licensed under the Apache License, Version 2.0.
**/
class Contentfinder {

	/**
	 * 
	 * Workflow:
	 *  1. Prep the document by removing script tags, css, etc.
	 *  2. Build readability's DOM tree.
	 *  3. Grab the article content from the current dom tree.
	 *
	 * @return innerHtml
	 **/
    constructor(preserveUnlikelyCandidates, html) {

        this.version = '';
        this.iframeLoads = 0;

        this.frameHack = false; /**
        * The frame hack is to workaround a firefox bug where if you
        * pull content out of a frame and stick it into the parent element, the scrollbar won't appear.
        * So we fake a scrollbar in the wrapping div.
        **/
        this.bodyCache = null;   /* Cache the body HTML in case we need to re-use it later */

        /**
          * All of the regular expressions in use within this.
          * Defined up here so we don't instantiate them repeatedly in loops.
          **/
        this.regexps = {
            unlikelyCandidatesRe: /combx|comment|disqus|foot|header|menu|meta|nav|rss|shoutbox|sidebar|sponsor/i,
            okMaybeItsACandidateRe: /and|article|body|column|main/i,
            positiveRe: /article|body|content|entry|hentry|page|pagination|post|text/i,
            negativeRe: /combx|comment|contact|foot|footer|footnote|link|media|meta|promo|related|scroll|shoutbox|sponsor|tags|widget/i,
            divToPElementsRe: /<(a|blockquote|dl|div|img|ol|p|pre|table|ul)/i,
            replaceBrsRe: /(<br[^>]*>[ \n\r\t]*){2,}/gi,
            replaceFontsRe: /<(\/?)font[^>]*>/gi,
            trimRe: /^\s+|\s+$/g,
            normalizeRe: /\s{2,}/g,
            killBreaksRe: /(<br\s*\/?>(\s|&nbsp;?)*){1,}/g,
            videoRe: /http:\/\/(www\.)?(youtube|vimeo)\.com/i
        };


        var dom = new JSDOM(html);
        this.document = dom.window.document;



        preserveUnlikelyCandidates = (typeof preserveUnlikelyCandidates == 'undefined') ? false : preserveUnlikelyCandidates;

        if (this.document.body && !this.bodyCache)
            this.bodyCache = this.document.body.innerHTML;

        this.prepDocument();


        var articleContent = this.grabArticle(preserveUnlikelyCandidates);

        this.articleContent = articleContent.innerHTML;
    }

    getArticleContent() {
        return this.articleContent;
    }

	/**
	 * Prepare the HTML document for readability to scrape it.
	 * This includes things like stripping javascript, CSS, and handling terrible markup.
	 * 
	 * @return void
	 **/
    prepDocument() {

		/**
		 * In some cases a body element can't be found (if the HTML is totally hosed for example)
		 * so we create a new body node and append it to the document.
		 */
        if (this.document.body === null) {
            body = this.document.createElement("body");
            try {
                this.document.body = body;
            }
            catch (e) {
                this.document.documentElement.appendChild(body);
            }
        }

        var frames = this.document.getElementsByTagName('frame');
        if (frames.length > 0) {
            var bestFrame = null;
            var bestFrameSize = 0;
            for (var frameIndex = 0; frameIndex < frames.length; frameIndex++) {
                var frameSize = frames[frameIndex].offsetWidth + frames[frameIndex].offsetHeight;
                var canAccessFrame = false;
                try {
                    frames[frameIndex].contentWindow.document.body;
                    canAccessFrame = true;
                } catch (e) { }

                if (canAccessFrame && frameSize > bestFrameSize) {
                    bestFrame = frames[frameIndex];
                    bestFrameSize = frameSize;
                }
            }

            if (bestFrame) {
                var newBody = this.document.createElement('body');
                newBody.innerHTML = bestFrame.contentWindow.document.body.innerHTML;
                newBody.style.overflow = 'scroll';
                this.document.body = newBody;

                var frameset = this.document.getElementsByTagName('frameset')[0];
                if (frameset)
                    frameset.parentNode.removeChild(frameset);

                this.frameHack = true;
            }
        }
        
        /* remove all scripts */
        var scripts = this.document.getElementsByTagName('script');
        for (var i = scripts.length - 1; i >= 0; i--) {
            //if (typeof (scripts[i].src) == "undefined") {
            scripts[i].parentNode.removeChild(scripts[i]);
            //}
        }

        /* remove all stylesheets */
        for (var k = 0; k < this.document.styleSheets.length; k++) {
            if (this.document.styleSheets[k].href != null && this.document.styleSheets[k].href.lastIndexOf("readability") == -1) {
                this.document.styleSheets[k].disabled = true;
            }
        }

        /* Remove all style tags   */
        var styleTags = this.document.getElementsByTagName("style");
        for (var i = styleTags.length - 1; i >= 0; i--) {
            styleTags[i].parentNode.removeChild(styleTags[i]);
        }

        /* Remove all noscript tags   */
        var noscriptTags = this.document.getElementsByTagName("noscript");
        for (var i = noscriptTags.length - 1; i >= 0; i--) {
            noscriptTags[i].parentNode.removeChild(noscriptTags[i]);
        }

        /* Turn all double br's into p's */
        /* Note, this is pretty costly as far as processing goes. Maybe optimize later. */
        this.document.body.innerHTML = this.document.body.innerHTML.replace(this.regexps.replaceBrsRe, '</p><p>').replace(this.regexps.replaceFontsRe, '<$1span>')
    }

	/**
	 * Prepare the article node for display. Clean out any inline styles,
	 * iframes, forms, strip extraneous <p> tags, etc.
	 *
	 * @param Element
	 * @return void
	 **/
    prepArticle(articleContent) {
        this.cleanStyles(articleContent);
        this.killBreaks(articleContent);

        /* Clean out junk from the article content */
        this.clean(articleContent, "form");
        this.clean(articleContent, "object");
        this.clean(articleContent, "h1");
		/**
		 * If there is only one h2, they are probably using it
		 * as a header and not a subheader, so remove it since we already have a header.
		***/
        if (articleContent.getElementsByTagName('h2').length == 1) {
            this.clean(articleContent, "h2");
        }
        this.clean(articleContent, "iframe");

        this.cleanHeaders(articleContent);

        /* Do these last as the previous stuff may have removed junk that will affect these */
        this.cleanConditionally(articleContent, "table");
        this.cleanConditionally(articleContent, "ul");
        this.cleanConditionally(articleContent, "div");

        /* Remove extra paragraphs */
        var articleParagraphs = articleContent.getElementsByTagName('p');
        for (var i = articleParagraphs.length - 1; i >= 0; i--) {
            var imgCount = articleParagraphs[i].getElementsByTagName('img').length;
            var embedCount = articleParagraphs[i].getElementsByTagName('embed').length;
            var objectCount = articleParagraphs[i].getElementsByTagName('object').length;

            if (imgCount == 0 && embedCount == 0 && objectCount == 0 && this.getInnerText(articleParagraphs[i], false) == '') {
                articleParagraphs[i].parentNode.removeChild(articleParagraphs[i]);
            }
        }

        try {
            articleContent.innerHTML = articleContent.innerHTML.replace(/<br[^>]*>\s*<p/gi, '<p');
        }
        catch (e) {
            dbg("Cleaning innerHTML of breaks failed.");
        }
    }

	/**
	 * Initialize a node with the readability object. Also checks the
	 * className/id for special names to add to its score.
	 *
	 * @param Element
	 * @return void
	**/
    initializeNode(node) {
        node.readability = { "contentScore": 0 };

        switch (node.tagName) {
            case 'DIV':
                node.readability.contentScore += 5;
                break;

            case 'PRE':
            case 'TD':
            case 'BLOCKQUOTE':
                node.readability.contentScore += 3;
                break;

            case 'ADDRESS':
            case 'OL':
            case 'UL':
            case 'DL':
            case 'DD':
            case 'DT':
            case 'LI':
            case 'FORM':
                node.readability.contentScore -= 3;
                break;

            case 'H1':
            case 'H2':
            case 'H3':
            case 'H4':
            case 'H5':
            case 'H6':
            case 'TH':
                node.readability.contentScore -= 5;
                break;
        }

        node.readability.contentScore += this.getClassWeight(node);
    }

	/***
	 * grabArticle - Using a variety of metrics (content score, classname, element types), find the content that is
	 *               most likely to be the stuff a user wants to read. Then return it wrapped up in a div.
	 *
	 * @return Element
	**/
    grabArticle(preserveUnlikelyCandidates) {

        var node = '';
		/**
		 * First, node prepping. Trash nodes that look cruddy (like ones with the class name "comment", etc), and turn divs
		 * into P tags where they have been used inappropriately (as in, where they contain no other block level elements.)
		 *
		 * Note: Assignment from index for performance. See http://www.peachpit.com/articles/article.aspx?p=31567&seqNum=5
		 * TODO: Shouldn't this be a reverse traversal?
		**/
        for (var nodeIndex = 0; (node = this.document.getElementsByTagName('*')[nodeIndex]); nodeIndex++) {
            /* Remove unlikely candidates */
            if (!preserveUnlikelyCandidates) {
                var unlikelyMatchString = node.className + node.id;
                if (unlikelyMatchString.search(this.regexps.unlikelyCandidatesRe) !== -1 &&
                    unlikelyMatchString.search(this.regexps.okMaybeItsACandidateRe) == -1 &&
                    node.tagName !== "BODY") {
                    dbg("Removing unlikely candidate - " + unlikelyMatchString);
                    node.parentNode.removeChild(node);
                    nodeIndex--;
                    continue;
                }
            }

            /* Turn all divs that don't have children block level elements into p's */
            if (node.tagName === "DIV") {
                if (node.innerHTML.search(this.regexps.divToPElementsRe) === -1) {
                    dbg("Altering div to p");
                    var newNode = this.document.createElement('p');
                    try {
                        newNode.innerHTML = node.innerHTML;
                        node.parentNode.replaceChild(newNode, node);
                        nodeIndex--;
                    }
                    catch (e) {
                        dbg("Could not alter div to p")
                    }
                }

            }
        }

		/**
		 * Loop through all paragraphs, and assign a score to them based on how content-y they look.
		 * Then add their score to their parent node.
		 *
		 * A score is determined by things like number of commas, class names, etc. Maybe eventually link density.
		**/
        var allParagraphs = this.document.getElementsByTagName("p");
        var candidates = [];

        for (var j = 0; j < allParagraphs.length; j++) {
            var parentNode = allParagraphs[j].parentNode;
            var grandParentNode = parentNode.parentNode;
            var innerText = this.getInnerText(allParagraphs[j]);

            /* If this paragraph is less than 25 characters, don't even count it. */
            if (innerText.length < 25)
                continue;

            /* Initialize readability data for the parent. */
            if (typeof parentNode.readability == 'undefined') {
                this.initializeNode(parentNode);
                candidates.push(parentNode);
            }

            /* Initialize readability data for the grandparent. */
            if (typeof grandParentNode.readability == 'undefined') {
                this.initializeNode(grandParentNode);
                candidates.push(grandParentNode);
            }

            var contentScore = 0;

            /* Add a point for the paragraph itself as a base. */
            contentScore++;

            /* Add points for any commas within this paragraph */
            contentScore += innerText.split(',').length;

            /* For every 100 characters in this paragraph, add another point. Up to 3 points. */
            contentScore += Math.min(Math.floor(innerText.length / 100), 3);

            /* Add the score to the parent. The grandparent gets half. */
            parentNode.readability.contentScore += contentScore;
            grandParentNode.readability.contentScore += contentScore / 2;
        }

		/**
		 * After we've calculated scores, loop through all of the possible candidate nodes we found
		 * and find the one with the highest score.
		**/
        var topCandidate = null;
        for (var i = 0, il = candidates.length; i < il; i++) {
			/**
			 * Scale the final candidates score based on link density. Good content should have a
			 * relatively small link density (5% or less) and be mostly unaffected by this operation.
			**/
            candidates[i].readability.contentScore = candidates[i].readability.contentScore * (1 - this.getLinkDensity(candidates[i]));

            dbg('Candidate: ' + candidates[i] + " (" + candidates[i].className + ":" + candidates[i].id + ") with score " + candidates[i].readability.contentScore);

            if (!topCandidate || candidates[i].readability.contentScore > topCandidate.readability.contentScore)
                topCandidate = candidates[i];
        }

		/**
		 * If we still have no top candidate, just use the body as a last resort.
		 * We also have to copy the body node so it is something we can modify.
		 **/
        if (topCandidate == null || topCandidate.tagName == "BODY") {
            topCandidate = this.document.createElement("DIV");
            topCandidate.innerHTML = this.document.body.innerHTML;
            this.document.body.innerHTML = "";
            this.document.body.appendChild(topCandidate);
            this.initializeNode(topCandidate);
        }


		/**
		 * Now that we have the top candidate, look through its siblings for content that might also be related.
		 * Things like preambles, content split by ads that we removed, etc.
		**/
        var articleContent = this.document.createElement("DIV");
        articleContent.id = "readability-content";
        var siblingScoreThreshold = Math.max(10, topCandidate.readability.contentScore * 0.2);
        var siblingNodes = topCandidate.parentNode.childNodes;
        for (var i = 0, il = siblingNodes.length; i < il; i++) {
            var siblingNode = siblingNodes[i];
            var append = false;

            dbg("Looking at sibling node: " + siblingNode + " (" + siblingNode.className + ":" + siblingNode.id + ")" + ((typeof siblingNode.readability != 'undefined') ? (" with score " + siblingNode.readability.contentScore) : ''));
            dbg("Sibling has score " + (siblingNode.readability ? siblingNode.readability.contentScore : 'Unknown'));

            if (siblingNode === topCandidate) {
                append = true;
            }

            if (typeof siblingNode.readability != 'undefined' && siblingNode.readability.contentScore >= siblingScoreThreshold) {
                append = true;
            }

            if (siblingNode.nodeName == "P") {
                var linkDensity = this.getLinkDensity(siblingNode);
                var nodeContent = this.getInnerText(siblingNode);
                var nodeLength = nodeContent.length;

                if (nodeLength > 80 && linkDensity < 0.25) {
                    append = true;
                }
                else if (nodeLength < 80 && linkDensity == 0 && nodeContent.search(/\.( |$)/) !== -1) {
                    append = true;
                }
            }

            if (append) {
                dbg("Appending node: " + siblingNode)

                /* Append sibling and subtract from our list because it removes the node when you append to another node */
                articleContent.appendChild(siblingNode);
                i--;
                il--;
            }
        }

		/**
		 * So we have all of the content that we need. Now we clean it up for presentation.
		**/
        this.prepArticle(articleContent);

        return articleContent;
    }

	/**
	 * Get the inner text of a node - cross browser compatibly.
	 * This also strips out any excess whitespace to be found.
	 *
	 * @param Element
	 * @return string
	**/
    getInnerText(e, normalizeSpaces) {
        var textContent = "";

        normalizeSpaces = (typeof normalizeSpaces == 'undefined') ? true : normalizeSpaces;


        textContent = e.textContent.replace(this.regexps.trimRe, "");

        if (normalizeSpaces)
            return textContent.replace(this.regexps.normalizeRe, " ");
        else
            return textContent;
    }

	/**
	 * Get the number of times a string s appears in the node e.
	 *
	 * @param Element
	 * @param string - what to split on. Default is ","
	 * @return number (integer)
	**/
    getCharCount(e, s) {
        s = s || ",";
        return this.getInnerText(e).split(s).length;
    }

	/**
	 * Remove the style attribute on every e and under.
	 * TODO: Test if getElementsByTagName(*) is faster.
	 *
	 * @param Element
	 * @return void
	**/
    cleanStyles(e) {
        e = e || this.document;
        var cur = e.firstChild;

        if (!e)
            return;

        // Remove any root styles, if we're able.
        if (typeof e.removeAttribute == 'function' && e.className != 'readability-styled')
            e.removeAttribute('style');

        // Go until there are no more child nodes
        while (cur != null) {
            if (cur.nodeType == 1) {
                // Remove style attribute(s) :
                if (cur.className != "readability-styled") {
                    cur.removeAttribute("style");
                }
                this.cleanStyles(cur);
            }
            cur = cur.nextSibling;
        }
    }

	/**
	 * Get the density of links as a percentage of the content
	 * This is the amount of text that is inside a link divided by the total text in the node.
	 * 
	 * @param Element
	 * @return number (float)
	**/
    getLinkDensity(e) {
        var links = e.getElementsByTagName("a");
        var textLength = this.getInnerText(e).length;
        var linkLength = 0;
        for (var i = 0, il = links.length; i < il; i++) {
            linkLength += this.getInnerText(links[i]).length;
        }

        return linkLength / textLength;
    }

	/**
	 * Get an elements class/id weight. Uses regular expressions to tell if this 
	 * element looks good or bad.
	 *
	 * @param Element
	 * @return number (Integer)
	**/
    getClassWeight(e) {
        var weight = 0;

        /* Look for a special classname */
        if (e.className != "") {
            if (e.className.search(this.regexps.negativeRe) !== -1)
                weight -= 25;

            if (e.className.search(this.regexps.positiveRe) !== -1)
                weight += 25;
        }

        /* Look for a special ID */
        if (typeof (e.id) == 'string' && e.id != "") {
            if (e.id.search(this.regexps.negativeRe) !== -1)
                weight -= 25;

            if (e.id.search(this.regexps.positiveRe) !== -1)
                weight += 25;
        }

        return weight;
    }

	/**
	 * Remove extraneous break tags from a node.
	 *
	 * @param Element
	 * @return void
	 **/
    killBreaks(e) {
        try {
            e.innerHTML = e.innerHTML.replace(this.regexps.killBreaksRe, '<br />');
        }
        catch (e) {
            dbg("KillBreaks failed");
        }
    }

	/**
	 * Clean a node of all elements of type "tag".
	 * (Unless it's a youtube/vimeo video. People love movies.)
	 *
	 * @param Element
	 * @param string tag to clean
	 * @return void
	 **/
    clean(e, tag) {
        var targetList = e.getElementsByTagName(tag);
        var isEmbed = (tag == 'object' || tag == 'embed');

        for (var y = targetList.length - 1; y >= 0; y--) {
            /* Allow youtube and vimeo videos through as people usually want to see those. */
            if (isEmbed && targetList[y].innerHTML.search(this.regexps.videoRe) !== -1) {
                continue;
            }

            targetList[y].parentNode.removeChild(targetList[y]);
        }
    }

	/**
	 * Clean an element of all tags of type "tag" if they look fishy.
	 * "Fishy" is an algorithm based on content length, classnames, link density, number of images & embeds, etc.
	 *
	 * @return void
	 **/
    cleanConditionally(e, tag) {
        var tagsList = e.getElementsByTagName(tag);
        var curTagsLength = tagsList.length;

		/**
		 * Gather counts for other typical elements embedded within.
		 * Traverse backwards so we can remove nodes at the same time without effecting the traversal.
		 *
		 * TODO: Consider taking into account original contentScore here.
		**/
        for (var i = curTagsLength - 1; i >= 0; i--) {
            var weight = this.getClassWeight(tagsList[i]);

            dbg("Cleaning Conditionally " + tagsList[i] + " (" + tagsList[i].className + ":" + tagsList[i].id + ")" + ((typeof tagsList[i].readability != 'undefined') ? (" with score " + tagsList[i].readability.contentScore) : ''));

            if (weight < 0) {
                tagsList[i].parentNode.removeChild(tagsList[i]);
            }
            else if (this.getCharCount(tagsList[i], ',') < 10) {
				/**
				 * If there are not very many commas, and the number of
				 * non-paragraph elements is more than paragraphs or other ominous signs, remove the element.
				**/

                var p = tagsList[i].getElementsByTagName("p").length;
                var img = tagsList[i].getElementsByTagName("img").length;
                var li = tagsList[i].getElementsByTagName("li").length - 100;
                var input = tagsList[i].getElementsByTagName("input").length;

                var embedCount = 0;
                var embeds = tagsList[i].getElementsByTagName("embed");
                for (var ei = 0, il = embeds.length; ei < il; ei++) {
                    if (embeds[ei].src.search(this.regexps.videoRe) == -1) {
                        embedCount++;
                    }
                }

                var linkDensity = this.getLinkDensity(tagsList[i]);
                var contentLength = this.getInnerText(tagsList[i]).length;
                var toRemove = false;

                if (img > p) {
                    toRemove = true;
                } else if (li > p && tag != "ul" && tag != "ol") {
                    toRemove = true;
                } else if (input > Math.floor(p / 3)) {
                    toRemove = true;
                } else if (contentLength < 25 && (img == 0 || img > 2)) {
                    toRemove = true;
                } else if (weight < 25 && linkDensity > .2) {
                    toRemove = true;
                } else if (weight >= 25 && linkDensity > .5) {
                    toRemove = true;
                } else if ((embedCount == 1 && contentLength < 75) || embedCount > 1) {
                    toRemove = true;
                }

                if (toRemove) {
                    tagsList[i].parentNode.removeChild(tagsList[i]);
                }
            }
        }
    }

	/**
	 * Clean out spurious headers from an Element. Checks things like classnames and link density.
	 *
	 * @param Element
	 * @return void
	**/
    cleanHeaders(e) {
        for (var headerIndex = 1; headerIndex < 7; headerIndex++) {
            var headers = e.getElementsByTagName('h' + headerIndex);
            for (var i = headers.length - 1; i >= 0; i--) {
                if (this.getClassWeight(headers[i]) < 0 || this.getLinkDensity(headers[i]) > 0.33) {
                    headers[i].parentNode.removeChild(headers[i]);
                }
            }
        }
    }

    htmlspecialchars(s) {
        if (typeof (s) == "string") {
            s = s.replace(/&/g, "&amp;");
            s = s.replace(/"/g, "&quot;");
            s = s.replace(/'/g, "&#039;");
            s = s.replace(/</g, "&lt;");
            s = s.replace(/>/g, "&gt;");
        }

        return s;
    }
}


module.exports = Contentfinder;