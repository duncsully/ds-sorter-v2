import { html, LitElement } from 'lit'
import { customElement, property } from 'lit/decorators.js'
// TODO: Implement PRNG with optional seed?
// TODO: Handle comparing different types?
// TODO: Add Rules setter validation?

/** A rule for configuring how to sort by an attribute or property value */
export interface Rule {
  /** Attribute name, or array representing a path of properties. (e.g. el.innerText -> ['innerText'] or el.someObj.someChild.someGrandchild -> ['someObj', 'someChild', 'someGrandchild'])  </br>
   * Note: Changes to values of sorted attributes will trigger a re-sort. Changes to sorted properties will not.
   */
  key: string | string[]
  /** Selector for descendant to get attribute/property off of */
  selector?: string
  /** If true, sort descending by default */
  descending?: boolean
}

const parseToRules = (value: string | null): Rule[] => {
  if (!value) return []
  // TODO: Validate with regex?
  const stringRules = value.split(/,\s*(?![^{}]*\})/)
  return stringRules.map((stringRule) => {
    const [rawKey, selector] = stringRule
      .replace('{', '')
      .split(/\}\s*/)
      .reverse()
    let key: string | string[] = rawKey

    const descending = key[0] === '>'
    if (descending) key = key.slice(1)

    if (key[0] === '.') {
      ;[, ...key] = key.split('.')
    }

    // Default to .innerText if selector and/or descending but no key
    if (key === undefined || key === '') {
      key = ['innerText']
    }

    return {
      key,
      selector,
      descending,
    }
  })
}

/**
 * A web component for sorting elements
 *
 * @element ds-sorter
 *
 * @slot - Content to sort
 */
@customElement('ds-sorter')
export class DsSorter extends LitElement {
  /**
   * If present, sorts randomly
   */
  @property({ type: Boolean }) random = false

  /**
   * A list of comma-separated rules to sort by in order of precedence. <br/>Specify attributes by name (e.g. "href"). If specifying a property, prepend with "." (e.g. ".innerText"). You can use nested properties as well (e.g. ".dataset.row"). <br/>Optionally, if you'd like to reverse a rule relative to the others, prepend a ">" (e.g. "href, >.innerText"). <br/>Finally, if you'd like to get a value of a descendant of the sorted element, wrap a selector in braces before the value and modifiers (e.g. {div label input} .checked).
   */
  @property()
  get by() {
    return this.rules
      .map(
        (rule) =>
          `${rule.selector ? `{${rule.selector}}` : ''} ${
            rule.descending ? '>' : ''
          }${
            typeof rule.key === 'string' ? rule.key : '.' + rule.key.join('.')
          }`
      )
      .join(', ')
  }
  set by(newBy) {
    // Will trigger update via rules prop, no need to do it here
    this.rules = parseToRules(newBy)
  }

  /**
   * A list of rule objects to sort the elements by. Refer to Rule interface for properties.
   */
  @property({ type: Array })
  rules: Rule[] = [{ key: ['innerText'] }]

  /**
   * Custom [comparison function](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/sort) for sorting
   */
  @property({ attribute: false }) comparator:
    | undefined
    | ((a: HTMLElement, b: HTMLElement) => number) = undefined

  /**
   * Sort in reverse order (rules that are ascending will be descending and vice versa)
   */
  @property({ type: Boolean }) reverse = false

  private get _slottedContent() {
    return Array.from(
      this.shadowRoot?.querySelector('slot')?.assignedElements() ?? []
    ) as HTMLElement[]
  }

  #mutationObserver = new MutationObserver((mutationList) => {
    const shouldUpdate = mutationList.some(
      (mutation) => mutation.type === 'attributes'
    )
    if (shouldUpdate) this.sort()
  })

  #elementAttrsMap = new WeakMap<HTMLElement, Set<string>>()

  disconnectedCallback() {
    super.disconnectedCallback()
    this.#mutationObserver.disconnect()
  }

  updated() {
    this.sort()
    this._slottedContent.forEach((elem) => {
      this.rules.forEach((rule) => {
        const { key, selector } = rule
        if (typeof key === 'string') {
          const observeElem = (
            selector ? elem.querySelector(selector) : elem
          ) as HTMLElement
          // Will throw console warning in .sort() if selector doesn't return element
          if (observeElem) {
            const attributeSet =
              this.#elementAttrsMap.get(observeElem) ?? new Set()
            attributeSet.add(key)
            this.#elementAttrsMap.set(observeElem, attributeSet)
            this.#mutationObserver.observe(observeElem, {
              attributeFilter: Array.from(attributeSet),
            })
          }
        }
      })
    })
  }

  render() {
    return html`<slot @slotchange=${this.sort}></slot>`
  }

  /**
   * @method
   * Manually trigger a sort, such as in response to an event e.g. <ds-sorter onchange="this.sort()">...</ds-sort>
   */
  sort(): void {
    this._slottedContent
      .sort(this.#compareElements)
      .forEach(
        (el, i) =>
          el.parentElement?.children[i] !== el &&
          el.parentElement?.appendChild(el)
      )
    this.dispatchEvent(
      new CustomEvent('ds-sort', { composed: true, bubbles: true })
    )
  }

  #compareElements = (
    a: HTMLElement,
    b: HTMLElement,
    rules = this.rules
  ): number => {
    if (this.random) {
      return Math.random() - 0.5
    }

    if (this.comparator) {
      return this.comparator(a, b) * (this.reverse ? -1 : 1)
    }

    const [rule, ...restRules] = rules
    // No rule found, don't sort
    if (!rule) {
      return 0
    }
    const { descending = false } = rule

    const firstVal = this.#getValue(a, rule)
    const secondVal = this.#getValue(b, rule)

    const lesser = this.reverse !== descending ? 1 : -1
    const greater = -lesser

    if (
      (firstVal == undefined && secondVal == undefined) ||
      firstVal === secondVal
    ) {
      // If current values are equal, move down the rules until something isn't equal or we run out of rules
      return restRules.length && this.#compareElements(a, b, restRules)
    }
    // send nullish values to the end
    if (firstVal == undefined && secondVal != undefined) {
      return greater
    }
    if (firstVal != undefined && secondVal == undefined) {
      return lesser
    }

    if (firstVal! < secondVal!) {
      return lesser
    }
    return greater
  }

  /** Normalize value for comparison */
  #getValue = (sortingElem: HTMLElement, rule: Rule) => {
    const { key, selector } = rule
    const elem = (
      selector ? sortingElem.querySelector(selector) : sortingElem
    ) as HTMLElement
    if (elem === null) {
      console.warn(`ds-sorter: Selector ${selector} did not return an element`)
      return undefined
    }

    if (typeof key === 'string') return elem.getAttribute(key)

    const [firstProp, ...nestedProps] = key

    if (!(firstProp in elem)) {
      console.warn(`ds-sorter: Element does not have property '${firstProp}'`)
      return undefined
    }
    let prop = elem[firstProp as keyof HTMLElement]
    let prevProp = firstProp
    for (const nestedProp of nestedProps) {
      if (prop == undefined || typeof prop !== 'object') {
        console.warn(
          `ds-sorter: Cannot access nested property '${nestedProp}' on element because property '${prevProp}' is not an object`,
          elem
        )
        return undefined
      }
      if (!(nestedProp in prop)) {
        console.warn(
          `ds-sorter: Element property '${prevProp}' does not contain nested property '${nestedProp}'`,
          elem
        )
        return undefined
      }

      prop = prop[nestedProp as keyof typeof prop]
      prevProp = nestedProp
    }

    // For now, just treat NaN as undefined since it doesn't compare nicely with anything, including itself
    if (typeof prop === 'number' && isNaN(prop)) {
      return undefined
    }

    const returnAsIs: (typeof prop)[] = [
      'number',
      'string',
      'boolean',
      'bigint',
      'undefined',
    ]

    if (returnAsIs.includes(typeof prop) || prop === null) {
      return prop
    }

    // TS doesn't think this could ever be a symbol (e.g. someone sets a symbol as the value of a property on an element. Why would anyone do this? I don't know, but they can if they want to.)
    if (typeof prop === 'symbol') {
      const { description } = prop as symbol
      console.warn(
        `The value being sorted by is a symbol. Using symbol description: "${description}".`
      )
      return description
    }

    if (typeof prop === 'function') {
      console.warn(
        'The value being sorted by is a function. Using value "true".'
      )
      // No good way to sort functions, just return that it exists
      return true
    }

    if (typeof prop === 'object') {
      // If array-like, return the length, else get the valueOf value if it's implemented
      return (prop as ArrayLike<unknown>)?.length ?? prop?.valueOf?.()
    }

    return undefined
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'ds-sorter': DsSorter
  }
}
