/**
 * @license
 * Copyright (C) 2013 KO GmbH <copyright@kogmbh.com>
 *
 * @licstart
 * This file is part of WebODF.
 *
 * WebODF is free software: you can redistribute it and/or modify it
 * under the terms of the GNU Affero General Public License (GNU AGPL)
 * as published by the Free Software Foundation, either version 3 of
 * the License, or (at your option) any later version.
 *
 * WebODF is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with WebODF.  If not, see <http://www.gnu.org/licenses/>.
 * @licend
 *
 * @source: http://www.webodf.org/
 * @source: https://github.com/kogmbh/WebODF/
 */

/*global Node, runtime, core, gui, ops, odf, xmldom*/

runtime.loadClass("odf.Namespaces");
runtime.loadClass("xmldom.LSSerializer");
runtime.loadClass("ops.OperationTransformer");

/**
 * @constructor
 * @param {core.UnitTestRunner} runner
 * @implements {core.UnitTest}
 */
ops.TransformationTests = function TransformationTests(runner) {
    "use strict";
    var r = runner, t, tests;

    function serialize(element) {
        var serializer = new xmldom.LSSerializer();
        return serializer.writeToString(element, odf.Namespaces.namespaceMap);
    }

    /**
     * Creates a deep copy of the spec
     * @param {!Object} spec
     * @return {!Object}
     */
    function cloneSpec(spec) {
        var result = {};

        Object.keys(spec).forEach(function (key) {
            if (typeof spec[key] === 'object') {
                result[key] = cloneSpec(spec[key]);
            } else {
                result[key] = spec[key];
            }
        });

        return result;
    }

    /**
     * Creates a deep copy of the specs
     * @param {!Array.<!Object>} specs
     * @return {!Array.<!Object>}
     */
    function cloneSpecs(specs) {
        var i, result = [];

        for(i = 0; i < specs.length; i += 1) {
            result.push(cloneSpec(specs[i]));
        }

        return result;
    }

    /**
     * Traverse the tree and sort cursors that are at the same position,
     * so identic sets of cursors are in an identic order.
     * @param {!Element} element
     * @param {!string} attrns
     * @param {!string} attrLocalName
     * @return {undefined}
     */
    function sortChildrenByNSAttribute(element, attrns, attrLocalName) {
        var child = element.firstChild,
            childArray = [],
            i;
        while(child) {
            if (child.nodeType === Node.ELEMENT_NODE) {
                childArray.push(child);
            }
            child = child.nextSibling;
        }
        childArray.sort(function(a, b) {
            var attra = a.getAttributeNS(attrns, attrLocalName),
                attrb = b.getAttributeNS(attrns, attrLocalName);
            return attra === attrb ? 0 :
                  (attra > attrb ?   1 :
                                    -1);
        });

        for(i = 0; i < childArray.length; i += 1) {
            element.appendChild(childArray[i]);
        }
    }

    /**
     * Traverse the tree and sort cursors that are at the same position,
     * so identic sets of cursors are in an identic order.
     * @param {!Node} node
     * @return {undefined}
     */
    function normalizeCursors(node) {
        var cursors, i,
            child = node.firstChild,
            cursorNs = "urn:webodf:names:cursor",
            cursorLocalName = "cursor",
            memberIdLocalName = "memberId";

        function compareMemberId(cursorA, cursorB) {
            var memberIdA = cursorA.getAttributeNS(cursorNs, memberIdLocalName),
                memberIdB = cursorB.getAttributeNS(cursorNs, memberIdLocalName);

            if (memberIdA < memberIdB) {
                return -1;
            }
            if (memberIdA > memberIdB) {
                return 1;
            }
            return 0;
        }

        while (child) {
            if (child.nodeType === Node.ELEMENT_NODE && child.localName === cursorLocalName && child.namespaceURI === cursorNs) {
                cursors = [child];
                // collect any next cursors
                child = child.nextSibling;
                while (child && child.nodeType === Node.ELEMENT_NODE && child.localName === cursorLocalName && child.namespaceURI === cursorNs) {
                    cursors.push(child);
                    child = child.nextSibling;
                }
                // if more than 1, reinsert them sorted
                if (cursors.length > 1) {
                    // sort
                    cursors.sort(compareMemberId);
                    // remove
                    for (i = 0; i < cursors.length; i += 1) {
                        node.removeChild(cursors[i]);
                    }
                    // reinsert sorted
                    for (i = 0; i < cursors.length; i += 1) {
                        node.insertBefore(cursors[i], child);
                    }
                }
            }
            if (child) {
                if (child.nodeType === Node.ELEMENT_NODE) {
                    normalizeCursors(child);
                }
                child = child.nextSibling;
            }
        }
    }

    /**
     * @param {!Element} element
     * @return {!Object}
     */
    function parseOperation(element) {
        var op = {},
            child = element.firstChild,
            atts = element.attributes,
            att,
            n = atts.length,
            i,
            value;
        // read plain data by attributes
        for (i = 0; i < n; i += 1) {
            att = atts.item(i);
            value = att.value;
            if (/^(length|number|position|fontSize|topMargin|bottomMargin|leftMargin|rightMargin)$/.test(att.localName)) {
                value = parseInt(value, 10);
            }
            op[att.nodeName] = value;
        }
        // read complex data by childs
        while(child) {
            if (child.nodeType === Node.ELEMENT_NODE) {
                op[child.nodeName] = parseOperation(/**@type{!Element}*/(child));
            }
            child = child.nextSibling;
        }
        return op;
    }
    /**
     * @param {!string} name
     * @param {!Element} opsElement
     * @return {!Array.<!Object>}
     */
    function parseOpspecs(name, opsElement) {
        var op = opsElement.firstElementChild,
            opspecs = [];
        while (op) {
            runtime.assert(op.localName === "op", "Expected <op/> in " + name + ".");
            opspecs.push(parseOperation(op));
            op = op.nextElementSibling;
        }
        return opspecs;
    }
    /**
     * @param {!Element} element
     * @return {!boolean}
     */
    function checkWhitespaceTexts(element) {
        var text = element.firstChild;
        return (element.childNodes.length === 1
            && element.hasAttributeNS(odf.Namespaces.textns, "c") === false
            && text.nodeType === Node.TEXT_NODE
            && text.textContent === " ");
    }
    /**
     * @param {!Element} rootElement
     * @return {!boolean}
     */
    function checkWhitespace(rootElement) {
        var i,
            spaceElements = rootElement.getElementsByTagNameNS(odf.Namespaces.textns, "s");
        for (i = 0; i < spaceElements.length; i+=1) {
            if (!checkWhitespaceTexts(spaceElements[i])) {
                return false;
            }
        }
        return true;
    }
    /**
     * @param {!string} name
     * @param {!Element} element
     * @return {!{before, opspecsA, opspecsB, after}}
     */
    function parseTest(name, element) {
        var before = element.firstElementChild,
            opsAElement = before.nextElementSibling,
            opsBElement = opsAElement.nextElementSibling,
            after = opsBElement.nextElementSibling;
        runtime.assert(before.localName === "before", "Expected <before/> in " + name + ".");
        runtime.assert(checkWhitespace(before), "Unexpanded test:s element or text:c attribute found in " + name + ".");
        runtime.assert(opsAElement.localName === "opsA", "Expected <ops/> in " + name + ".");
        runtime.assert(opsBElement.localName === "opsB", "Expected <ops/> in " + name + ".");
        runtime.assert(after.localName === "after", "Expected <after/> in " + name + ".");
        runtime.assert(checkWhitespace(after), "Unexpanded test:s element or text:c attribute found in " + name + ".");
        return {
            before: before,
            opspecsA:   parseOpspecs(name, opsAElement),
            opspecsB:   parseOpspecs(name, opsBElement),
            after:  after
        };
    }

    /**
     * @param {!Element} a
     * @param {!Element} b
     * @return {undefined}
     */
    function copyChildNodes(a, b) {
        while (b.firstChild) {
            b.removeChild(b.firstChild);
        }
        var n = a.firstChild;
        while (n) {
            if (a.ownerDocument === b.ownerDocument) {
                b.appendChild(n.cloneNode(true));
            } else {
                b.appendChild(b.ownerDocument.importNode(n, true));
            }
            n = n.nextSibling;
        }
    }

    /**
     * @param {!Element} element
     * @param {!string} localName
     * @return {?Element}
     */
    function getOfficeNSElement(element, localName) {
        var e = element.getElementsByTagNameNS(odf.Namespaces.officens, localName);

        if (e.length === 1) {
            return e[0];
        }
        return null;
    }

    /**
     * @param {!Element} element
     * @return {!Element}
     */
    function getOfficeTextElement(element) {
        var textElement = getOfficeNSElement(element, "text");
        runtime.assert(textElement !== null, "Missing <office:text>!");
        return /**@type {!Element}*/(textElement);
    }

    /**
     * @param {!Element} element
     * @return {?Element}
     */
    function getOfficeStylesElement(element) {
        return getOfficeNSElement(element, "styles");
    }

    function compareOpsExecution(opspecs, transformedOps, before, after) {
        var odfContainer,
            odtDocument,
            text,
            textbefore = getOfficeTextElement(before),
            textafter = getOfficeTextElement(after),
            styles,
            stylesbefore = getOfficeStylesElement(before),
            stylesafter = getOfficeStylesElement(after),
            i,
            op;

        odfContainer = new odf.OdfContainer("", null);
        t.odfcanvas.setOdfContainer(odfContainer);
        odtDocument = new ops.OdtDocument(t.odfcanvas);
        text = odtDocument.getRootNode();
        styles = odfContainer.rootElement.styles;

        // inject test data
        if (stylesbefore) {
            copyChildNodes(stylesbefore, styles);
        }
        copyChildNodes(textbefore, text);

        // execute opspecs
        for (i = 0; i < opspecs.length; i += 1) {
            // runtime.log("Going to apply:"+runtime.toJson(opspecs[i]));
            op = t.operationFactory.create(opspecs[i]);
            t.opResult = op.execute(odtDocument);
            r.shouldBe(t, "t.opResult", "true");
        }
        // execute transformedOps
        for (i = 0; i < transformedOps.length; i += 1) {
            // runtime.log("Going to apply:"+runtime.toJson(transformedOps[i].spec()));
            t.opResult = transformedOps[i].execute(odtDocument);
            r.shouldBe(t, "t.opResult", "true");
        }

        // check result
        if (stylesbefore) {
            stylesafter.normalize();
            // for now just normalize the order of the styles to create
            // comparability
            // any possible orderless listing in the style subchilds will be
            // only cared for once it is needed
            sortChildrenByNSAttribute(stylesafter, odf.Namespaces.stylens, "name");
            styles.normalize();
            sortChildrenByNSAttribute(styles, odf.Namespaces.stylens, "name");
            if (!r.areNodesEqual(stylesafter, styles)) {
                t.styles = serialize(styles);
                t.stylesafter = serialize(stylesafter);
            } else {
                t.styles = t.stylesafter = "OK";
            }
            r.shouldBe(t, "t.styles", "t.stylesafter");
        }

        textafter.normalize();
        normalizeCursors(textafter);
        text.normalize();
        normalizeCursors(text);
        if (!r.areNodesEqual(textafter, text)) {
            t.text = serialize(text);
            t.after = serialize(textafter);
        } else {
            t.text = t.after = "OK";
        }
        r.shouldBe(t, "t.text", "t.after");
    }

    function runTest(test) {
        var transformer = new ops.OperationTransformer();

        transformer.setOperationFactory(t.operationFactory);
        t.transformResult = transformer.transform(cloneSpecs(test.opspecsA), cloneSpecs(test.opspecsB));
        r.shouldBeNonNull(t, "t.transformResult");
        if (t.transformResult) {
            compareOpsExecution(test.opspecsA, t.transformResult.opsB, test.before, test.after);
            compareOpsExecution(test.opspecsB, t.transformResult.opsA, test.before, test.after);
        }
    }

    function makeTestIntoFunction(name, test) {
        var f = function () {
            runTest(test);
        };
        f.testName = name;
        return f;
    }

    function makeTestsIntoFunction(tests) {
        var functions = [], i;
        for (i in tests) {
            if (tests.hasOwnProperty(i)) {
                functions.push(makeTestIntoFunction(i, tests[i]));
            }
        }
        return functions;
    }

    function loadTests(url, tests) {
        var s = runtime.readFileSync(url, "utf-8"),
            xml = runtime.parseXML(s),
            n,
            testName;
        runtime.assert(s.length > 0, "XML file is empty.");
        runtime.assert(xml.documentElement.localName === "tests", "Element is not <tests/>.");
        n = xml.documentElement.firstElementChild;
        while (n) {
            testName = n.getAttribute("name");
            runtime.assert(n.localName === "test", "Element is not <test/>.");
            runtime.assert(!tests.hasOwnProperty(testName), "Test name " + testName + " is not unique.");
            tests[testName] = parseTest(testName, n);
            n = n.nextElementSibling;
        }
    }

    function loadTestFiles(urls) {
        var trafoTests = {}, i;
        for (i = 0; i < urls.length; i += 1) {
            loadTests(urls[i], trafoTests);
        }
        return trafoTests;
    }

    this.setUp = function () {
        var testarea;
        t = {};
        testarea = core.UnitTest.provideTestAreaDiv();
        t.odfcanvas = new odf.OdfCanvas(testarea);
        t.operationFactory = new ops.OperationFactory();
    };
    this.tearDown = function () {
        t = {};
        core.UnitTest.cleanupTestAreaDiv();
    };
    this.tests = function () {
        if (!tests) {
            tests = makeTestsIntoFunction(loadTestFiles(
                ["ops/transformationtests.xml"]
            ));
        }
        return tests;
    };
    this.asyncTests = function () {
        return [
        ];
    };
};

ops.TransformationTests.prototype.description = function () {
    "use strict";
    return "Test the transformations of ODT operations described in an XML file on consistent ODT dom results.";
};
(function () {
    "use strict";
    return ops.TransformationTests;
}());