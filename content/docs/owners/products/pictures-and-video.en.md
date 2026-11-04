---
title: Pictures, videos and 3D
summary: Add pictures, videos and 3D models to a product, describe them for shoppers who cannot see them, and keep the media library tidy.
track: owners
section: products
kind: how-to
areas: [products, website]
features: [shop]
plans: []
admin: /admin/{store}/products/{productId}
order: 50
checked: 2026-11-04
sources: [D84, D88, D89, D213, D325, D349, D413]
---

## Add pictures to a product

Open the product and find **Pictures and videos**. Press **Add pictures** and choose one or more files. Large files are fine: each
picture is made smaller in your browser before it is uploaded, at most 1600 pixels wide, until it is as small as it can be while it
still looks the same. Nothing but the result leaves your browser.

- **The first item is the one shoppers see** in lists, in the cart and in your product feeds. Press **← Earlier** or **Later →** to
  change the order.
- **Remove** takes an item off the product. The file stays in your media library.
- Press **Save** to keep the changes.

A product holds up to 20 items, of which up to 5 videos and 3 3D models. The editor says so under the card.

## Describe each picture

Under each picture, fill in **Describe the picture** in a few words: what it shows, for shoppers who use a screen reader and for
search engines. Left empty, the product's title is used.

If your store sells in more than one language, open **In other languages** under the picture and write it in each. A language left
empty uses the product's title in that language. These words are also listed in
[Translate the store](/admin/{store}/translate) with your other texts.

## Add a video

Press **Add a video**, then either:

- **Upload a video**: an MP4 or WebM file of up to 50 MB. It is compressed in your browser, at most 1080p, and a picture taken from
  the video is shown before it plays.
- **Or paste a YouTube or Vimeo address**, choose a **Picture shown before it plays**, and press **Add the video**. Nothing is
  fetched from YouTube or Vimeo.

On the product page a video never starts by itself: the shopper presses play. A YouTube or Vimeo video is only loaded from there at
that press. Write a few words under **Describe the video**.

## Add a 3D model

Open **More** and press **Add a 3D model**. Choose **The model (GLB file)**, up to 20 MB, and a **Picture shown before it is
opened**, then press **Add the model**. Export the model from your 3D program as GLB: a glTF is several files and is refused.

Shoppers see the picture with **View in 3D**. Pressing it loads the model, which they turn by dragging and zoom by pinching or
scrolling. Fill in **Describe what the model shows**.

## Give a variant its own picture

If the product comes in options, each variant under **Price and stock** has a small square beside its name. Press it and choose one
of the product's pictures, or **Upload a picture**. When a shopper chooses that variant, the gallery shows its picture first.

## The media library

Everything you upload anywhere in the admin is kept in the media library: open **Website** and choose
[Media](/admin/{store}/media). There you can:

- **Add files**: drop pictures (JPEG, PNG, WebP, AVIF or GIF) and videos (MP4 or WebM), as many as you like at once. Each is
  compressed in your browser first.
- **Search the library** by a file's name or alt text, and, when your AI is set up for it, by what a picture shows.
- **Open a file** to see where it is used, write its alt text, or press **Copy address** or **Download**.
- **Delete** a file. The confirmation lists every place that uses it: a picture there shows nothing until you choose another.
  Deleting cannot be undone.

To clear out old files, press **Choose files**, then **Choose those not in use**, and delete them together.

### Alt texts

A picture's **Alt text** in the library is shown wherever the picture has no description of its own, such as a variant's picture or a
picture on a page. Write it and press **Save alt text**, or press **Write with AI**.

When your AI has a model that sees pictures, **Write missing alt texts with AI** writes one for every picture without, in every
language of the site, and new pictures get theirs within a few minutes. A run for all pictures keeps the texts your staff wrote.

## Make older files smaller

Files uploaded before Kaizena Flow compressed them can still be made smaller. Under **Compress files**, the library says how many
are waiting; press the button to compress them all, or open one file and press **Compress**. Each is made as small as it can be
while it still looks the same, in your browser, and every place that uses it moves to the smaller file.

## Remove a background

Open a picture in the media library. Under **Edit with AI**, choose **Remove the background** and press **Edit the picture**. It
takes up to a minute. The result is a new picture in the library; the original stays as it was. **New background** and **Change
something** work the same way, with a few words from you.

In the page builder, every picture field that has a picture offers **Remove background** beside **Make with AI**.

Editing pictures needs a model that edits pictures, chosen in your store's AI settings. Until then the library says so, with a link.

> [!TIP]
> The product editor adds pictures from your computer. To use an edited picture on a product, press **Download** on it in the
> library, then add it under **Pictures and videos**.

## More options

- **Make a picture with AI.** **Make with AI**, under **Pictures and videos**, makes a new picture from your words. See
  [AI texts and pictures](/docs/owners/ai/ai-texts-and-pictures).
- **Products are part of the online shop**, which every new store starts with. It is switched on and off under Settings, Features.
