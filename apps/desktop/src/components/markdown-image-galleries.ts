import type { Element, ElementContent, Root, RootContent } from 'hast'

const isImage = (node?: RootContent) => node?.type === 'element' && node.tagName === 'img'
const isSpace = (node: RootContent) => (node.type === 'text' && !node.value.trim()) || (node.type === 'element' && node.tagName === 'br')
const isParagraph = (node?: RootContent): node is Element & { tagName: 'p' } => node?.type === 'element' && node.tagName === 'p'

function splitGalleries(paragraph: Element): Element[] {
  const nodes = paragraph.children
  const blocks: Element[] = []
  let proseStart = 0
  const addProse = (end: number) => {
    const children = nodes.slice(proseStart, end)
    if (children.some((node) => !isSpace(node))) blocks.push({ ...paragraph, children })
  }
  for (let i = 0; i < nodes.length; i++) {
    if (!isImage(nodes[i])) continue
    const images: ElementContent[] = [nodes[i]]
    let lastImage = i
    for (let j = i + 1; j < nodes.length; j++) {
      if (isSpace(nodes[j])) continue
      if (!isImage(nodes[j])) break
      images.push(nodes[j])
      lastImage = j
    }
    if (images.length === 1) continue
    addProse(i)
    blocks.push({ type: 'element', tagName: 'figure', properties: {}, children: images })
    proseStart = lastImage + 1
    i = lastImage
  }
  if (!blocks.length) return [paragraph]
  addProse(nodes.length)
  return blocks
}

/** Join neighboring image runs across Markdown paragraph breaks, keeping captions and linked images intact. */
export function markdownImageGalleries() {
  function visit(parent: Root | Element) {
    const blocks: RootContent[] = []
    const nodes = parent.children
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]
      if (isParagraph(node) && node.children.some(isImage)) {
        let paragraph = node
        while (isImage(paragraph.children.at(-1))) {
          let j = i + 1
          while (j < nodes.length && isSpace(nodes[j])) j++
          const next = nodes[j]
          if (!isParagraph(next) || !isImage(next.children.find((child) => !isSpace(child)))) break
          if (paragraph === node) paragraph = { ...node, children: [...node.children] }
          paragraph.children.push(...next.children)
          i = j
        }
        blocks.push(...splitGalleries(paragraph))
      } else {
        if (node.type === 'element' && ['blockquote', 'li', 'ol', 'ul'].includes(node.tagName)) visit(node)
        blocks.push(node)
      }
    }
    parent.children = blocks
  }
  return (tree: Root) => visit(tree)
}
