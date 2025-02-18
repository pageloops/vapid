// TODO: Clean this up. Lots of hacky stuff in here
const { readFileSync } = require('fs');
const { parse, relative } = require('path');
const Boom = require('@hapi/boom');
const Goatee = require('./goatee');
const { Utils } = require('../utils');

const QUOTES = ['"', "'"];

// TODO: Don't need branch *and* leaf
const BRANCH_REGEX = /^(?:(section|form)\s)?(\w+)(.*)/i;
const PARTIALS_REGEX = /{{\s*>\s*([\w/_-]+)\s*}}/g;
const PARTIALS_DEPTH = 2;

// Matches {{[   ][(context).]key[( remainder=whatever)]}}
const LEAF_REGEX = /^(\w+)(\.\w+)?(.*)/i;
function parseLeaf(str) {
  // TODO: If this fails, throw a helpful template parsing error.
  let [, context, key, remainder] = str.match(LEAF_REGEX);

  // If there is no key, this must be an un-prefixed path.
  if (!key) {
    key = context;
    context = null;
  // Else if there is a key and context, strip the leading `.` from the key.
  } else {
    key = key.slice(1);
  }

  // We are strictly case insensitive, and hate whitespace!.
  key = key.toLowerCase().trim();
  context = context ? context.toLowerCase().trim() : context;
  remainder = remainder.trim();

  // Re-assemble a sanitized full path.
  const path = context ? `${context}.${key}` : key;

  // Parse our params in to a usable object.
  const params = _parseParams(remainder);

  return {
    key, context, path, params, remainder,
  };
}

/**
 * TemplateCompiler class
 * Used in conjunction with a modified version of Mustache.js (Goatee)
 */
class TemplateCompiler {
  /**
   * @param {string} html
   * @param {array} partials - collection of partial templates
   */
  constructor(html, partials = {}, options = {}) {
    // Worried about this getting too big, so it's being cleared.
    Goatee.clearCache();
    this.html = _replacePartials(html, partials);
    this.options = Utils.merge({}, options);
  }

  /**
   * @static
   *
   * Reads HTML from a file, then creates a TemplateCompiler instance
   *
   * @param {string} filePath - the absolute path to a file
   * @param {string} basePath - shared base path of file and partials
   * @param {array} partials - collection of partial templates
   * @param {object} options
   * @return {TemplateCompiler} - a new instance of TemplateCompiler
   */
  static fromFile(filePath, basePath = process.cwd(), partialPaths = [], options = {}) {
    const html = readFileSync(filePath, 'utf8');
    const partials = partialPaths.reduce((memo, path) => {
      const rel = relative(basePath, path);
      const parts = parse(rel);
      const key = [parts.dir, parts.name.slice(1)].filter(Boolean).join('/');

      /* eslint-disable-next-line no-param-reassign */
      memo[key] = readFileSync(path, 'utf-8');
      return memo;
    }, {});

    return new TemplateCompiler(html, partials, options);
  }

  /**
   * Parses the HTML, and creates a template tree
   *
   * @return {Object} - a representation of the content
   */
  parse() {
    let tokens;

    try {
      tokens = Goatee.parse(this.html);
    } catch (err) {
      throw Boom.boomify(err, {
        message: 'Bad template syntax',
      });
    }

    return _walk.call(this, {}, tokens);
  }

  /**
   * Applies content to the template
   *
   * @param {Object} content
   * @return {string} - HTML that has tags replaced with content
   */
  render(content = {}) {
    const body = !Utils.isEmpty(content.general) ? _wrapHTML(this.html) : this.html;
    let rendered = Goatee.render(body, content);

    // TODO
    rendered = _bustCache(rendered);

    return rendered;
  }
}


/**
 * @private
 *
 * Recursively walks Mustache tokens, and creates a tree that Vapid understands.
 *
 * @param {Object} tree - a memo that holds the total tree value
 * @param {array} branch - Mustache tokens
 * @param {string} branchToken - current branch name and params
 * @return {Object} tree of sections, fields, params, etc.
 */
/* eslint-disable no-param-reassign */
function _walk(tree, branch, branchToken = 'general') {
  // console.log("_walk", branch, branchToken);

  tree[branchToken] = tree[branchToken] || _initBranch(branchToken);

  branch.forEach((leaf) => {
    switch (leaf[0]) {
      case 'name': {
        _addToTree(tree, branchToken, leaf[1]);
        break;
      }
      case '#': {
        const parsedLeaf = parseLeaf(leaf[1].toLowerCase());

        if (Goatee.CONDITIONALS.includes(parsedLeaf.key)) {
          _addToTree(tree, branchToken, parsedLeaf.remainder);
          _walk.call(this, tree, leaf[4], branchToken);
        } else {
          _walk.call(this, tree, leaf[4], leaf[1]);
        }

        break;
      }
      default: {
        // Do nothing
      }
    }
  });

  return tree;
}
/* eslint-enable no-param-reassign */

/**
 * @private
 *
 * Initializes a tree branch
 *
 * @param {string} branchToken - branch name an params
 * @return {Object}
 */
function _initBranch(branchToken) {
  const [, keyword, name, remainder] = branchToken.match(BRANCH_REGEX);

  return {
    name: name.toLowerCase(),
    keyword,
    params: _parseParams(remainder),
    fields: {},
  };
}

/**
 * @private
 *
 * Parses a leaf token, and merges into the branch
 *
 * @params {Object} tree
 * @params {string} branchToken
 * @params {string} leftToken;
 * @return {Object}
 */
function _addToTree(tree, branchToken, leafToken) {
  /* eslint-disable max-len, no-param-reassign */
  const leafValue = Utils.merge(tree[branchToken].fields[leafToken] || {}, parseLeaf(leafToken));
  tree[branchToken].fields[leafToken] = leafValue;
  /* eslint-enable max-len, no-param-reassign */

  return tree;
}

/**
 * @private
 *
 * Turns a token into an object of params
 *
 * @param {string} str
 * @return {Object}
 *
 * @example
 * _parseParams('required=false placeholder="Your Name"')
 * // returns { required: false, placeholder: 'Your Name' }
 *
 * @todo Find better way to parse and allow escaped quotes (including _stripQuotes).
 */
function _parseParams(str) {
  const params = {};
  const args = str.match(/(?:[\w.]+|["'][^=]*)\s*=\s*(?:[\w,-]+|["'][^'"](?:[^"\\]|\\.)*["'])/g) || [];

  args.forEach((a) => {
    const [key, val] = a.split('=');
    params[key.toLowerCase()] = _stripQuotes(val);
  });

  return params;
}

/**
 * @private
 *
 * Removes outside single or double quotes.
 * Used in conjunction with _parseParams, super hacky.
 *
 * @param {string} str - string with quotes
 * @return {string} string without quotes
 *
 * @todo Revisit both this an _parseParams
 */
function _stripQuotes(str) {
  const unescaped = str.replace(/\\"/g, '"').replace(/\\'/g, '\'');
  const lastIndex = unescaped.length - 1;
  const first = unescaped.charAt(0);
  const last = unescaped.charAt(lastIndex);

  if (first === last && QUOTES.indexOf(first) >= 0) {
    return unescaped.substring(1, lastIndex);
  }

  return unescaped;
}

/**
 * @private
 *
 * Wraps HTML in Vapid 'general' section tags
 *
 * @param {string} html
 * @return {string} wrapped html
 */
function _wrapHTML(html) {
  return `{{#general}}${html}{{/general}}`;
}

/**
 * @private
 *
 * Cache busting
 *
 * @param {string} html
 * @return {string} cache busted HTML
 *
 * @todo Placeholder, need to implement. Not sure this is the right class for it though.
 */
function _bustCache(html) {
  return html;
}

/**
 * @private
 *
 * Replaces partial template tags with partial content
 *
 * @param {Object} partials - partial names and content
 * @return {string} html
 */
function _replacePartials(html, partials) {
  let result = html;

  if (!Utils.isEmpty(partials)) {
    for (let i = 0; i < PARTIALS_DEPTH; i += 1) {
      result = result.replace(PARTIALS_REGEX, (_match, name) => partials[name] || '');
    }
  }

  return result;
}

module.exports = TemplateCompiler;
