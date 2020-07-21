const { Utils } = require('../utils');

/**
 * Defaults
 *
 * @attr {string} [class=''] - <img> class attribute
 * @attr {string} [alt=''] - <img> alt attribute
 * @options {boolean} [tag=true] - render <img> or return raw src
 */
const DEFAULTS = {
  attrs: {
    class: '',
    alt: '',
    width: '',
    height: '',
  },
  options: {
  },
};

module.exports = (BaseDirective) => {
  /*
   * Upload and render images in <picture> tag with srcset
   */
  class PictureDirective extends BaseDirective {
    /**
     * @static
     *
     * @return {Object} default attrs and options
     */
    static get DEFAULTS() {
      return DEFAULTS;
    }

    /**
     * Renders inputs necessary to upload, preview, and optionally remove images
     *
     * @param {string} name
     * @param {string} [value=this.options.default]
     * @return {string} rendered HTML
     *
     * eslint-disable class-methods-use-this
     */
    input(name, value = ['']) {
      const inputs = `<input type="file" name="${name}" accept="image/*">
                    <input type="hidden" name="${name}" value="${value}">`;
      const preview = value ? `<img class="preview" src="/uploads/${value[0]}">` : '';
      const destroy = !this.attrs.required && preview
        ? `<div class="ui checkbox">
             <input type="checkbox" name="${name.replace('content', '_destroy')}">
             <label>Delete</label>
           </div>`
        : '';

      return `
        <div class="previewable">
          ${inputs}
          ${preview}
          ${destroy}
        </div>`;
    }
    /* eslint-enable class-methods-use-this */

    /**
     * Renders <picture> tag or raw src
     *
     * @param {string} fileName
     * @return {string}
     */
    render(fileNames) {
      fileNames = fileNames || [];
      if (typeof fileNames === 'string') {
        fileNames = fileNames.split(',');
      }

      if (fileNames.length <= 0) return null;

      let sources = '';
      fileNames.forEach(name => {
        const suffix = name.split('.').slice(-1).pop(); // take last part
        sources += `<source srcset="/uploads/${name}" type="image/${suffix}">`;
      });
      
      return `<picture>${sources}
          <img src="/uploads/${fileNames[fileNames.length-1]}${this._queryString}" ${this._tagAttrs}>  
        </picture>`;
    }

    /**
     * A preview of the image
     *
     * @param {string} fileName
     * @return {string}
     */
    preview(fileName) {
      // Always render a tag
      this.options.tag = true;
      return this.render(fileName);
    }

    /**
     * @private
     *
     * Converts attrs to img tag attrs
     *
     * @return {string}
     */
    get _tagAttrs() {
      return Object.keys(this.attrs)
        .map((key) => {
          const val = this.attrs[key];
          return val && `${key}="${Utils.escape(val)}"`;
        })
        .filter(Boolean)
        .join(' ');
    }

    /**
     * @private
     *
     * Converts width/height to a query string
     *
     * @return {string}
     */
    get _queryString() {
      const qs = (['width', 'height'])
        .map((key) => {
          const val = this.attrs[key];
          return val && `${key[0]}=${Number(val)}`;
        })
        .filter(Boolean)
        .join('&');
      return qs ? `?${qs}` : '';
    }
  }

  return PictureDirective;
};
