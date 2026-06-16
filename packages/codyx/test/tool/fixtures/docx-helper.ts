import { BlobWriter, ZipWriter, TextReader } from "@zip.js/zip.js"

export async function createDocxBuffer(text: string): Promise<Buffer> {
  const writer = new BlobWriter("application/zip")
  const zip = new ZipWriter(writer)

  const contentTypes = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '<Default Extension="xml" ContentType="application/xml"/>',
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>',
    "</Types>",
  ].join("")
  await zip.add("[Content_Types].xml", new TextReader(contentTypes))

  const rels = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>',
    "</Relationships>",
  ].join("")
  await zip.add("_rels/.rels", new TextReader(rels))

  const docRels = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>',
    "</Relationships>",
  ].join("")
  await zip.add("word/_rels/document.xml.rels", new TextReader(docRels))

  const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  const paragraphs = escaped
    .split("\n")
    .filter((p) => p.length > 0 || true)
    .map((p) => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`)
    .join("")

  const doc = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
    "<w:body>",
    paragraphs,
    "</w:body>",
    "</w:document>",
  ].join("")
  await zip.add("word/document.xml", new TextReader(doc))

  await zip.close()
  const blob = await writer.getData()
  return Buffer.from(await blob.arrayBuffer())
}

export async function createCorruptedDocx(): Promise<Buffer> {
  return Buffer.from("not a valid docx file at all", "utf-8")
}
