/**
 * @author Nate Murray
 * @license MIT
 * @module remark:inline-links
 * @fileoverview
 *   Plug-in to deal w/ leanpub markdown
 */

"use strict";

/*
 * Dependencies.
 */

var visit = require("unist-util-visit");
var trim = require("trim");
var fs = require("fs");
var path = require("path");
var repeat = require("repeat-string");
var cq = require("@fullstackio/cq").default;
var debug = require("debug")("remark-cq");
var trim = require("trim-trailing-lines");

var has = Object.prototype.hasOwnProperty;

var C_NEWLINE = "\n";
var C_TAB = "\t";
var C_SPACE = " ";
var C_GT = ">";
var C_LEFT_BRACE = "{";
var C_RIGHT_BRACE = "}";
var C_LEFT_PAREN = "(";
var C_RIGHT_PAREN = ")";
var C_PERCENT = "%";
var EMPTY = "";
var T_BREAK = "break";
var T_TEXT = "text";
var CODE_INDENT_LENGTH = 4;
var CODE_INDENT = repeat(C_SPACE, CODE_INDENT_LENGTH);

var Parser;
var __options = {};
var __lastBlockAttributes = {};

/**
 * Find a possible Code Imports
 *
 * @example
 *   locateCodeImport('foo \n<<[my-file.js](my-file.js)'); // 4
 *
 * @param {string} value - Value to search.
 * @param {number} fromIndex - Index to start searching at.
 * @return {number} - Location of possible mention sequence.
 */
function locateCodeImport(value, fromIndex) {
    var index = value.indexOf(C_NEWLINE, fromIndex);

    if (value.charAt(index + 1) !== "<" && value.charAt(index + 2) !== "<") {
        return;
    }

    return index;
}

/**
 * Tokenize a code import
 *
 * (For now, it just strips them, TODO is to actually import this file)
 *
 * @example
 *   tokenizeCodeImport(eat, '\n<<[my-file.js](my-file.js)');
 *
 * @property {Function} locator - Mention locator.
 * @param {function(string)} eat - Eater.
 * @param {string} value - Rest of content.
 * @param {boolean?} [silent] - Whether this is a dry run.
 * @return {Node?|boolean} - `delete` node.
 */
function codeImport(eat, value, silent) {
    var match = /^(<<.*?)\s*$/m.exec(value);
    var handle;
    var url;

    if (match) {
        var fileMatches = /<<\[(.*)\]\((.*)\)/.exec(match);
        var statedFilename = fileMatches[1];
        var actualFilename = fileMatches[2];
        console.log("actualFilename: ", actualFilename);

        // todo cache this
        var codeString = fs
            .readFileSync(path.join(__options.root, actualFilename))
            .toString();
        var array = codeString.split("\n");
        var lines = "";
        var language = __lastBlockAttributes["lang"]
            ? __lastBlockAttributes["lang"].toLowerCase()
            : "javascript";

        if (__lastBlockAttributes["crop-query"]) {
            var cqOpts = {};
            if (__lastBlockAttributes["undent"]) {
                cqOpts.undent = true;
            }

            var results = cq(
                codeString,
                __lastBlockAttributes["crop-query"],
                cqOpts
            );
            lines = results.code;
        } else {
            var cropStartLine = __lastBlockAttributes["crop-start-line"]
                ? parseInt(__lastBlockAttributes["crop-start-line"])
                : 1;
            var cropEndLine = __lastBlockAttributes["crop-end-line"]
                ? parseInt(__lastBlockAttributes["crop-end-line"])
                : array.length;
            lines = array.slice(cropStartLine - 1, cropEndLine).join("\n");
        }

        // TODO -- if we invent a new type
        // we may get some benefits when we convert to React
        return eat(match[0])({
            type: "code",
            lang: language || null,
            meta: null,
            value: lines
        });
    }
}

function codeImportBlock(eat, value, silent) {
    var index = -1;
    var length = value.length + 1;
    var subvalue = EMPTY;
    var character;
    var handle;
    var url;
    var marker;
    var markerCount;
    var queue;

    // eat initial spacing
    while (++index < length) {
        character = value.charAt(index);

        if (character !== C_TAB && character !== C_SPACE) {
            break;
        }

        subvalue += character;
    }

    if (value.charAt(index) !== "<") {
        return;
    }

    // require <<
    if (value.charAt(index + 1) !== "<") {
        return;
    }

    marker = character;
    subvalue += character;
    markerCount = 1;
    queue = EMPTY;

    while (++index < length) {
        character = value.charAt(index);

        // console.log(character);

        if (character !== C_RIGHT_PAREN) {
            // no newlines allowed in the import blocks
            if (character === C_NEWLINE) {
                return;
            }

            markerCount++;
            subvalue += queue + character;
            queue = EMPTY;
        } else if (character === C_RIGHT_PAREN) {
            subvalue += queue + C_RIGHT_PAREN;
        }
    }

    var match = /^(<<.*?)\s*$/m.exec(subvalue);
    if (!match) return;

    var fileMatches = /<<\[(.*)\]\((.*)\)/.exec(match);
    var statedFilename = fileMatches[1];
    var actualFilename = fileMatches[2];

    // todo cache this
    var codeString = fs
        .readFileSync(path.join(__options.root, actualFilename))
        .toString();
    var array = codeString.split("\n");
    var lines = "";
    var language = __lastBlockAttributes["lang"]
        ? __lastBlockAttributes["lang"].toLowerCase()
        : "javascript";

    if (__lastBlockAttributes["crop-query"]) {
        var cqOpts = {};
        if (__lastBlockAttributes["undent"]) {
            cqOpts.undent = true;
        }

        var results = cq(
            codeString,
            __lastBlockAttributes["crop-query"],
            cqOpts
        );
        lines = results.code;
    } else {
        var cropStartLine = __lastBlockAttributes["crop-start-line"]
            ? parseInt(__lastBlockAttributes["crop-start-line"])
            : 1;
        var cropEndLine = __lastBlockAttributes["crop-end-line"]
            ? parseInt(__lastBlockAttributes["crop-end-line"])
            : array.length;
        lines = array.slice(cropStartLine - 1, cropEndLine).join("\n");
    }

    // TODO -- if we invent a new type
    // we may get some benefits when we convert to React
    return eat(subvalue)({
        type: "code",
        lang: language || null,
        meta: null,
        value: trim(lines)
    });
}

codeImport.locator = locateCodeImport;

/**
 * Find a possible Block Inline Attribute List
 *
 * @example
 *   locateMention('foo \n{lang='js'}'); // 4
 *
 * @param {string} value - Value to search.
 * @param {number} fromIndex - Index to start searching at.
 * @return {number} - Location of possible mention sequence.
 */
function locateBlockInlineAttributeList(value, fromIndex) {
    var index = value.indexOf(C_NEWLINE, fromIndex);

    if (value.charAt(index + 1) !== "{") {
        return;
    }

    if (value.charAt(index + 2) == "%") {
        return;
    }

    return index;
}

/**
 * Tokenize a block inline attribute list.
 *
 * (For now, it just strips them)
 *
 * @example
 *   tokenizeBlockInlineAttributeList(eat, '\n{foo=bar}');
 *
 * @property {Function} locator - Mention locator.
 * @param {function(string)} eat - Eater.
 * @param {string} value - Rest of content.
 * @param {boolean?} [silent] - Whether this is a dry run.
 * @return {Node?|boolean} - `delete` node.
 */
function blockInlineAttributeList(eat, value, silent) {
    var match = /^{(.*?)}\s*$/m.exec(value);
    var handle;
    var url;

    if (match) {
        return eat(match[0])({
            type: "text",
            value: ""
        });
    }
}

// http://stackoverflow.com/questions/25058134/javascript-split-a-string-by-comma-except-inside-parentheses
function splitNoParen(s) {
    let results = [];
    let next;
    let str = "";
    let left = 0,
        right = 0;

    function keepResult() {
        results.push(str);
        str = "";
    }

    for (var i = 0; i < s.length; i++) {
        switch (s[i]) {
            case ",":
                if (left === right) {
                    keepResult();
                    left = right = 0;
                } else {
                    str += s[i];
                }
                break;
            case "(":
                left++;
                str += s[i];
                break;
            case ")":
                right++;
                str += s[i];
                break;
            default:
                str += s[i];
        }
    }
    keepResult();
    return results;
}

function dequotifyString(str) {
    var innerStringMatch = /^['"](.*?)['"]$/.exec(str);
    var destringifiedValue =
        innerStringMatch && innerStringMatch[1] ? innerStringMatch[1] : str;
    return destringifiedValue;
}

// blockInlineAttributeList.locator = locateBlockInlineAttributeList;

/**
 * Tokenise a block inline attribute list
 *
 * @example
 *   tokenizeBlockInlineAttributeList(eat, '{lang=javascript}');
 *
 * @param {function(string)} eat - Eater.
 * @param {string} value - Rest of content.
 * @param {boolean?} [silent] - Whether this is a dry run.
 * @return {Node?|boolean} - `thematicBreak` node.
 */
function tokenizeBlockInlineAttributeList(eat, value, silent) {
    // console.log('tokenizeBlockInlineAttributeList');
    var self = this;
    var index = -1;
    var length = value.length + 1;
    var subvalue = EMPTY;
    var character;
    var marker;
    var markerCount;
    var queue;

    // eat initial spacing
    while (++index < length) {
        character = value.charAt(index);

        if (character !== C_TAB && character !== C_SPACE) {
            break;
        }

        subvalue += character;
    }

    if (value.charAt(index) !== C_LEFT_BRACE) {
        return;
    }

    // ignore {{ thing }}
    if (value.charAt(index + 1) === C_LEFT_BRACE) {
        return;
    }

    // ignore {% thing %}
    if (value.charAt(index + 1) === C_PERCENT) {
        return;
    }

    marker = character;
    subvalue += character;
    markerCount = 1;
    queue = EMPTY;

    while (++index < length) {
        character = value.charAt(index);

        // console.log(character);

        if (character !== C_RIGHT_BRACE) {
            // no newlines allowed in the attribute blocks
            if (character === C_NEWLINE) {
                return;
            }

            markerCount++;
            subvalue += queue + character;
            queue = EMPTY;
        } else if (
            // markerCount >= THEMATIC_BREAK_MARKER_COUNT &&
            character === C_RIGHT_BRACE
        ) {
            subvalue += queue + C_RIGHT_BRACE;

            function parseBlockAttributes(attrString) {
                // e.g. {lang='JavaScript',starting-line=4,crop-start-line=4,crop-end-line=26}
                var matches = /{(.*?)}/.exec(attrString);
                var blockAttrs = {};

                if (!matches || !matches[1]) {
                    console.log(
                        "WARNING: remark-cq unknown attrString",
                        attrString
                    );
                    // hmm...
                    return blockAttrs;
                }

                // var pairs = matches[1].split(/,\s*/);
                var pairs = splitNoParen(matches[1]);

                pairs.forEach(function(pair) {
                    var kv = pair.split(/=\s*/);

                    // var innerStringMatch = /^'(.*?)'$/.exec(kv[1]);
                    // var destringifiedValue = (innerStringMatch && innerStringMatch[1]) ? innerStringMatch[1] : kv[1];
                    // blockAttrs[kv[0]] = destringifiedValue;

                    blockAttrs[kv[0]] = kv[1];
                });
                return blockAttrs;
            }

            __lastBlockAttributes = parseBlockAttributes(subvalue);
            // console.log('__lastBlockAttributes', __lastBlockAttributes);

            if (__options.preserveEmptyLines) {
                return eat(subvalue)({ type: T_BREAK });
            } else {
                return eat(subvalue)({ type: T_TEXT, value: EMPTY });
            }
        } else {
            // console.log("see ya", subvalue);
            return;
        }
    }
}

/**
 * Attacher.
 *
 * @param {Remark} remark - Processor.
 *
 * @return {function(node)} - Transformer.
 */
function attacher(options) {
    Parser = this.Parser;

    var proto = Parser.prototype;
    var methods = proto.inlineMethods;

    __options = options || {};
    __options.root = __options["root"] || process.cwd();
    __options.preserveEmptyLines = __options.hasOwnProperty(
        "preserveEmptyLines"
    )
        ? __options.preserveEmptyLines
        : false;

    /*
     * Add a tokenizer to the `Parser`.
     */
    // proto.inlineTokenizers.codeImport = codeImport;
    // methods.splice(methods.indexOf("inlineText"), 0, "codeImport");

    proto.blockTokenizers.codeImport = codeImportBlock;
    proto.blockMethods.splice(
        proto.blockMethods.indexOf("newline"),
        0,
        "codeImport"
    );

    // Why do we need to strip blockInlineAttributeLists??
    // Because it loads some state for any blocks that follow
    proto.blockTokenizers.blockInlineAttributeList = tokenizeBlockInlineAttributeList;
    proto.blockMethods.splice(
        proto.blockMethods.indexOf("newline"),
        0,
        "blockInlineAttributeList"
    );

    // Good news -- none of the leanpub stuff is necessary
    // Tokenize T> W> blocks
    // proto.blockTokenizers.blockquote = tokenizeAnnotatedBlockquote;

    /*
    old but maybe useful
    // proto.blockTokenizers.indentedCode = tokenizeCodeWithOpts;
    // tokenizeCodeWithOpts.locator = proto.blockTokenizers.code.locator;
    // proto.blockTokenizers.code = tokenizeCodeWithOpts;
    */

    /*
    old but maybe useful?
    function transformer(node, file) {
      currentFilePath = file.filePath();
      console.log(currentFilePath);
    }
    return transformer;
    */
}

/*
 * Expose.
 */

module.exports = attacher;
