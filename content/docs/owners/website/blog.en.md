---
title: Write a blog
summary: Write articles in the page builder, publish them now or later, and run your blogs, their authors and the comments visitors leave.
track: owners
section: website
kind: how-to
areas: [website, marketing]
features: []
plans: []
admin: /admin/{store}/articles
order: 30
checked: 2026-11-04
sources: [D50, D57, D340, D341]
---

## Write an article

Open **Website** in the menu and choose [Blog](/admin/{store}/articles). Press **New article** and give it a title.

An article is built in the same page builder as your pages, with rows, columns and components:
[Build pages in the page builder](/docs/owners/website/the-page-builder) explains it. Your blog is at `/blog`, newest articles first, and
each article at `/blog/` followed by its address.

In the article's settings, on the right:

- **Author**: choose one of your authors, or type a name under **Written by**. It is shown under the title with the date and told to
  search engines. Left empty, the store is shown as the author.
- **Categories and tags**: sort your articles. Each blog category and tag has its own list of articles on your site.
- **Picture**: shown at the top of the article, in lists and when the article is shared.
- **Excerpt**: a short text for lists of articles. Empty uses the search description, then the start of the text.

## Publish it

The bar at the foot is the same as for pages: **Save draft** keeps your work, **Publish** puts the article in your blog, and **Unpublish**
takes it out again. When you publish changes later, the article keeps the date it was first published.

### Publish it later

Once the article is saved, press **Schedule** beside Publish. Choose a **Day** and a **Time** on your store's clock: the draft as it is
then is published, within five minutes of that time. While your store is not open, the schedule waits. The Blog list shows when each
article is due, and says so if one did not publish.

## More than one blog

Most stores need one blog. For a second one, such as news beside recipes, press **Blogs** on the Blog list, then **Add a blog**:

- **Name**, in each of your store's languages. Left empty, the blog is called Blog in the shopper's language.
- **Address**: the blog is at `/blogs/` followed by it.
- **Comments**: how visitors' comments are shown (see [Comments](#comments)).
- **What its address shows**: the list of its articles, or one of your published pages.

Press **Save the blog**. A store can have up to 20 blogs.

Once you have more than one, an article's blog is chosen under **In the blog** in its settings. The first blog always stays at `/blog`, so
its links never change, and it cannot be deleted. Another blog can be deleted once its articles are moved to another blog.

Each blog has a feed that readers can follow in a feed reader, with its newest 50 published articles: its address is under **Feed** on
the Blogs page.

> [!TIP]
> To build the first blog's page in the page builder, choose one under **Special pages** on the [Pages](/admin/{store}/pages) list.

## Authors

On the Blogs page, press **Authors**, then **Add an author**: their **Name**, a **Picture** from your media library, **A few words about
them** and a **Link** to a page about them. Press **Save the author**.

Choose the author under **Author** in an article's settings. The article then shows them under it, with their picture and words, and
names them to search engines. A store can have up to 100 authors. When you delete one, their articles show the name typed on them.

## Comments

Each blog has its own setting under **Comments**:

- **Off**: no comment form, and no comments are shown.
- **Held for you to read**: a comment is shown once you approve it. A new blog starts with this, the safe choice.
- **Shown at once**: comments that pass the spam check are shown at once; the rest wait for you.

**Comments**, on the Blog list, shows how many wait. Open it to read them under **Waiting**, **Shown**, **Spam** and **Refused**. For each
comment, press **Approve**, **Refuse**, **Spam** or **Delete**. Where the spam check found something, the comment says what.

A comment is shown as plain text: links and markup in it are not followed. Refused and spam comments are deleted after 30 days.

> [!NOTE]
> Comments are personal data. When someone asks for a copy of their data, or for it to be erased, their comments are included:
> [Personal data](/docs/owners/customers/personal-data) explains these requests.

## More options

- **Countries.** In a store that sells in more than one country, an article can be kept to some of them, as a page can.
- **Categories and tags** on the Blog list manages your blog's categories and tags. A content grid on any page can show articles, and a
  menu can link to the blog, an article or a blog category: see
  [Menus, header and footer](/docs/owners/website/menus-header-and-footer).
