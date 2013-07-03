/**
 * @license
 * Copyright (C) 2012-2013 KO GmbH <copyright@kogmbh.com>
 *
 * @licstart
 * The JavaScript code in this page is free software: you can redistribute it
 * and/or modify it under the terms of the GNU Affero General Public License
 * (GNU AGPL) as published by the Free Software Foundation, either version 3 of
 * the License, or (at your option) any later version.  The code is distributed
 * WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or
 * FITNESS FOR A PARTICULAR PURPOSE.  See the GNU AGPL for more details.
 *
 * As additional permission under GNU AGPL version 3 section 7, you
 * may distribute non-source (e.g., minimized or compacted) forms of
 * that code without the copy of the GNU GPL normally required by
 * section 4, provided you include this license notice and a URL
 * through which recipients can access the Corresponding Source.
 *
 * As a special exception to the AGPL, any HTML file which merely makes function
 * calls to this code, and for that purpose includes it by reference shall be
 * deemed a separate work for copyright law purposes. In addition, the copyright
 * holders of this code give you permission to combine this code with free
 * software libraries that are released under the GNU LGPL. You may copy and
 * distribute such a system following the terms of the GNU AGPL for this code
 * and the LGPL for the libraries. If you modify this code, you may extend this
 * exception to your version of the code, but you are not obligated to do so.
 * If you do not wish to do so, delete this exception statement from your
 * version.
 *
 * This license applies to this entire compilation.
 * @licend
 * @source: http://www.webodf.org/
 * @source: http://gitorious.org/webodf/webodf/
 */
/*global Node, odf, runtime, console, NodeFilter, core*/

runtime.loadClass("core.LoopWatchDog");
runtime.loadClass("odf.Namespaces");
runtime.loadClass("odf.OdfUtils");

/**
 * Class for applying a supplied text style to all text nodes within a range.
 * @constructor
 * @param {!odf.Formatting} formatting Formatting retrieval and computation store
 * @param {!Node} automaticStyles Root element for automatic styles
 */
odf.TextStyleApplicator = function TextStyleApplicator(formatting, automaticStyles) {
    "use strict";
    var nextTextNodes,
        odfUtils = new odf.OdfUtils(),
        /**@const@type {!string}*/ textns = odf.Namespaces.textns,
        /**@const@type {!string}*/ stylens = odf.Namespaces.stylens,
        textProperties = "style:text-properties",
        webodfns = "urn:webodf:names:scope";

    /**
     * @param {!Object} info Style information
     * @constructor
     */
    function StyleLookup(info) {
        function compare(expected, actual) {
            if (typeof expected === "object" && typeof actual === "object") {
                return Object.keys(expected).every(function(key) {
                    return compare(expected[key], actual[key]);
                });
            }
            return expected === actual;
        }

        this.isStyleApplied = function(textNode) {
            // TODO make this performant...
            // TODO take into account defaults and don't require styles if re-iterating the default impacts
            // TODO can direct style to element just be removed somewhere to end up with desired style?
            var appliedStyle = formatting.getAppliedStylesForElement(textNode);
            return compare(info, appliedStyle);
        };
    }

    /**
     * Responsible for maintaining a collection of creates auto-styles for re-use on
     * styling new containers.
     * @param {!Object} info Style information
     * @constructor
     */
    function StyleManager(info) {
        var createdStyles = {};

        function createDirectFormat(existingStyleName, document) {
            var existingStyleNode,
                styleNode;

            if (existingStyleName) {
                existingStyleNode = formatting.getStyleElement(existingStyleName, "text");
                if (existingStyleNode.parentNode === automaticStyles) {
                    // This is an automatic style, clone the properties and combine into a new automatic style
                    styleNode = existingStyleNode.cloneNode(true);
                } else {
                    // This is a named style. Create a new automatic style that inherits from the parent style
                    styleNode = document.createElementNS(stylens, "style:style");
                    styleNode.setAttributeNS(stylens, "style:parent-style-name", existingStyleName);
                    styleNode.setAttributeNS(stylens, "style:family", "text");
                    styleNode.setAttributeNS(webodfns, "scope", "document-content");
                }
            } else {
                styleNode = document.createElementNS(stylens, "style:style");
                styleNode.setAttributeNS(stylens, "style:family", "text");
                styleNode.setAttributeNS(webodfns, "scope", "document-content");
            }
            formatting.updateStyle(styleNode, info, true);
            automaticStyles.appendChild(styleNode);
            return styleNode;
        }

        function getDirectStyle(existingStyleName, document) {
            existingStyleName = existingStyleName || "";
            if (!createdStyles.hasOwnProperty(existingStyleName)) {
                createdStyles[existingStyleName] = createDirectFormat(existingStyleName, document);
            }
            return createdStyles[existingStyleName].getAttributeNS(stylens, "name");
        }

        /**
         * Applies the required styling changes to the supplied container.
         * @param container
         */
        this.applyStyleToContainer = function(container) {
            // container will be a span by this point, and the style-name can only appear in one place
            var name = getDirectStyle(container.getAttributeNS(textns, "style-name"), container.ownerDocument);
            container.setAttributeNS(textns, "text:style-name", name);
        };
    }

    // TODO Push into common area and remove duplicate code
    function containsNode(limits, node) {
        var range = node.ownerDocument.createRange(),
            nodeLength = node.nodeType === Node.TEXT_NODE ? node.length : node.childNodes.length,
            result;
        range.setStart(limits.startContainer, limits.startOffset);
        range.setEnd(limits.endContainer, limits.endOffset);
        result = range.comparePoint(node, 0) === 0 && range.comparePoint(node, nodeLength) === 0;
        range.detach();
        return result;
    }

    // TODO Push into common area and remove duplicate code in cursor
    function splitBoundaries(range) {
        var newNode;

        // Must split end first to stop the start point from being lost
        if (range.endOffset !== 0
            && range.endContainer.nodeType === Node.TEXT_NODE
            && range.endOffset !== range.endContainer.length) {
            nextTextNodes.push(range.endContainer.splitText(range.endOffset));
            nextTextNodes.push(range.endContainer);
            // The end doesn't need to be reset as endContainer & endOffset are still valid after the modification
        }

        if (range.startOffset !== 0
            && range.startContainer.nodeType === Node.TEXT_NODE
            && range.startOffset !== range.startContainer.length) {
            newNode = range.startContainer.splitText(range.startOffset);
            nextTextNodes.push(range.startContainer);
            nextTextNodes.push(newNode);
            range.setStart(newNode, 0);
        }
    }

    // TODO Push into common area and remove duplicate code in cursor
    function mergeTextNodes(node1, node2) {
        if (node1.nodeType === Node.TEXT_NODE) {
            if (node1.length === 0) {
                node1.parentNode.removeChild(node1);
            } else if (node2.nodeType === Node.TEXT_NODE) {
                node2.insertData(0, node1.data);
                node1.parentNode.removeChild(node1);
                return node2;
            }
        }
        return node1;
    }

    // TODO Push into common area and remove duplicate code in cursor
    function cleanupTextNode(node) {
        if (node.nextSibling) {
            node = mergeTextNodes(node, node.nextSibling);
        }
        if (node.previousSibling) {
            mergeTextNodes(node.previousSibling, node);
        }
    }

    /**
     * Moves the specified node and all further siblings within the outer range into a new standalone container
     * @param {!CharacterData} startNode Node to start movement to new container
     * @param {!{startContainer: Node, startOffset: !number, endContainer: Node, endOffset: !number}} limits style application bounds
     * @returns {!Element}  Returns the container node that is to be restyled
     */
    function moveToNewSpan(startNode, limits) {
        var document = startNode.ownerDocument,
            originalContainer = startNode.parentNode,
            styledContainer,
            trailingContainer,
            moveTrailing,
            node = startNode,
            nextNode,
            loopGuard = new core.LoopWatchDog(1000);

        // Do we need a new style container?
        if (odfUtils.isParagraph(originalContainer)) {
            // Yes, text node has no wrapping span
            styledContainer = document.createElementNS(textns, "text:span");
            originalContainer.insertBefore(styledContainer, startNode);
            moveTrailing = false;
        } else if (startNode.previousSibling && !containsNode(limits, startNode.previousSibling)) {
            // Yes, text node has prior siblings that are not styled
            // TODO what elements should be stripped when the clone occurs?
            styledContainer = originalContainer.cloneNode(false);
            originalContainer.parentNode.insertBefore(styledContainer, originalContainer.nextSibling);
            moveTrailing = true;
        } else {
            // No, repossess the current container
            styledContainer = originalContainer;
            moveTrailing = true;
        }

        // Starting at the startNode, iterate forward until leaving the affected range
        while (node && (node === startNode || containsNode(limits, node))) {
            loopGuard.check();
            nextNode = node.nextSibling;
            if (node.parentNode !== styledContainer) {
                styledContainer.appendChild(node);
            }
            node = nextNode;
        }

        // Any trailing nodes?
        if (node && moveTrailing) {
            // Yes, create a trailing container
            trailingContainer = styledContainer.cloneNode(false);
            styledContainer.parentNode.insertBefore(trailingContainer, styledContainer.nextSibling);

            // Starting at the first node outside the affected range, move each node across
            while (node) {
                loopGuard.check();
                nextNode = node.nextSibling;
                trailingContainer.appendChild(node);
                node = nextNode;
            }
        }

        // TODO clean up empty spans that are left behind
        return /**@type {!Element}*/ (styledContainer);
    }

    /**
     * Apply the specified text style to all text nodes within the given range
     * @param {!Range} range Range to apply text style to
     * @param {!Object} info Style information. Only data within "style:text-properties" will be considered and applied
     */
    this.applyStyle = function(range, info) {
        var textNodes,
            isStyled,
            container,
            styleCache,
            styleLookup,
            textPropsOnly = {},
            limits;

        runtime.assert(Boolean(info[textProperties]), "applyStyle without any text properties");
        textPropsOnly[textProperties] = info[textProperties];
        styleCache = new StyleManager(textPropsOnly);
        styleLookup = new StyleLookup(textPropsOnly);

        nextTextNodes = []; // Reset instance node-modified stack
        splitBoundaries(range);
        textNodes = odfUtils.getTextNodes(range, false);
        // Avoid using the passed in range as boundaries move in strange ways as the DOM is modified
        limits = {
            startContainer: range.startContainer,
            startOffset: range.startOffset,
            endContainer: range.endContainer,
            endOffset: range.endOffset
        };
        textNodes.forEach(function(n) {
            isStyled = styleLookup.isStyleApplied(n);
            if (isStyled === false) {
                container = moveToNewSpan(/**@type {!CharacterData}*/(n), limits);
                styleCache.applyStyleToContainer(container);
            }
        });
        nextTextNodes.forEach(cleanupTextNode);
        nextTextNodes = null;
    };
};