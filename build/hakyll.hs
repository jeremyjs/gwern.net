#!/usr/bin/env runhaskell
{-# LANGUAGE OverloadedStrings #-}

{-
Hakyll file for building gwern.net
Author: gwern
Date: 2010-10-01
When: Time-stamp: "2020-12-02 14:23:58 gwern"
License: CC-0

Debian dependencies:
$ sudo apt-get install libghc-hakyll-dev libghc-pandoc-dev libghc-filestore-dev libghc-tagsoup-dev libghc-yaml-dev imagemagick s3cmd git libghc-aeson-dev libghc-missingh-dev libghc-digest-dev tidy gridsite-clients

(GHC is needed for Haskell; Hakyll & Pandoc do the heavy lifting of compiling Markdown files to HTML; tag soup & ImageMagick are runtime dependencies used to help optimize images, and s3cmd/git upload to hosting/Github respectively.)
Demo command (for the full script, with all static checks & generation & optimizations, see `sync-gwern.net.sh`):

$ cd ~/wiki/ && ghc -rtsopts -threaded -O2 -fforce-recomp -optl-s --make hakyll.hs &&
  ./hakyll rebuild +RTS -N3 -RTS && echo -n -e '\a'  &&
  s3cmd -v -v --human-readable-sizes --reduced-redundancy --no-mime-magic --guess-mime-type --default-mime-type=text/html
        --add-header="Cache-Control: max-age=604800, public" --delete-removed sync _site/ s3://www.gwern.net/ &&
  rm -rf ~/wiki/_cache/ ~/wiki/_site/ && rm ./hakyll *.o *.hi ;
  git push; echo -n -e '\a'

Explanations:

- we could run Hakyll with a command like `./hakyll.hs build` but this would run much slower than if we compile an optimized parallelized binary & run it with multiple threads; this comes at the cost of considerable extra complexity in the invocation, though, since we need to compile it with fancy options, run it with other options, and then at the end clean up by deleting the compiled binary & intermediates (GHC cannot take care of them on its own: https://ghc.haskell.org/trac/ghc/ticket/4114 )
- `rebuild` instead of 'build' because IIRC there was some problem where Hakyll didn't like extension-less files so incremental syncs/builds don't work; this tells Hakyll
 to throw everything away without even trying to check
- s3cmd:

    - `--reduced-redundancy` saves a bit of money; no need for high-durability since everything is backed up locally in the git repo, after all
    - s3cmd's MIME type detection has been unreliable in the past due to long-standing bugs in `python-magic` (particularly with CSS), so we need to force a default, especially for the extension-less (HTML) files
- after that, we clean up after ourselves and sync with the Github mirror as well
- the 'echo' calls are there to ring the terminal bell and notify the user that he needs to edit the Modafinil file or that the whole thing is done
-}

import Control.Exception (onException)
import Control.Monad (when, void)
import Data.Char (toLower, isLetter)
import Data.List (isPrefixOf, nub, sort)
import Data.Maybe (fromMaybe)
import Data.Monoid ((<>))
import Network.HTTP (urlEncode)
import qualified Data.Map as M (fromList, lookup, Map)
import System.Directory (doesFileExist)
import System.FilePath (takeBaseName, takeExtension)
import Data.FileStore.Utils (runShellCommand)
import Hakyll (applyTemplateList, buildTags, compile, composeRoutes, constField, compressCss, cached, readTemplate, getResourceString,
               symlinkFileCompiler, dateField, defaultContext, defaultHakyllReaderOptions, field, getMetadata, lookupString,
               defaultHakyllWriterOptions, fromCapture, getRoute, gsubRoute, hakyll, idRoute, itemIdentifier,
               loadAll, loadAndApplyTemplate, loadBody, makeItem, match, modificationTimeField, mapContext,
               pandocCompilerWithTransformM, route, setExtension, pathField, preprocess,
               tagsField, tagsRules, templateCompiler, version, Compiler, Context, Item, Pattern, Template, Tags, unsafeCompiler)
import System.Exit (ExitCode(ExitFailure))
import Text.HTML.TagSoup (renderTagsOptions, parseTags, renderOptions, optMinimize, optRawTag, Tag(TagOpen))
import Text.Pandoc.Shared (blocksToInlines)
import Text.Pandoc (nullAttr, runPure, runWithDefaultPartials, compileTemplate,
                    -- Extension(Ext_markdown_in_html_blocks), ReaderOptions(..), bottomUp, topDown,
                    def, pandocExtensions, readerExtensions, readMarkdown, writeHtml5String,
                    Block(..), HTMLMathMethod(MathJax), defaultMathJaxURL, Inline(..),
                    ObfuscationMethod(NoObfuscation), Pandoc(..), WriterOptions(..))
import Text.Pandoc.Walk (walk, walkM) -- walkInlineM

import Data.List.Utils (replace)
import qualified Data.Text as T

-- local custom modules:
-- import Definition -- (dictionary)
import Inflation (nominalToRealInflationAdjuster)
import LinkMetadata (readLinkMetadata, annotateLink, Metadata)
import LinkArchive (localizeLink, readArchiveMetadata, ArchiveMetadata)
import Typography

main :: IO ()
main = hakyll $ do
             tags <- buildTags "**.page" (fromCapture "tags/*")

             -- popup metadata:
             preprocess $ print ("Popups parsing..." :: String)
             meta <- preprocess readLinkMetadata
             preprocess $ print ("Local archives parsing..." :: String)
             archive <- preprocess readArchiveMetadata
             -- preprocess $ print ("Local abbreviations parsing..." :: String)
             -- definitions <- preprocess dictionary
             -- preprocess $ print archive

             match "**.page" $ do
                 -- strip extension since users shouldn't care if HTML3-5/XHTML/etc (cool URLs); delete apostrophes/commas & replace spaces with hyphens
                 -- as people keep screwing them up endlessly:
                 route $ gsubRoute "," (const "") `composeRoutes` gsubRoute "'" (const "") `composeRoutes` gsubRoute " " (const "-") `composeRoutes`
                          setExtension ""
                 -- https://groups.google.com/forum/#!topic/pandoc-discuss/HVHY7-IOLSs
                 let readerOptions = defaultHakyllReaderOptions -- {
                       -- readerExtensions = Data.Set.filter (/=Ext_markdown_in_html_blocks) $ readerExtensions defaultHakyllReaderOptions }
                 compile $ pandocCompilerWithTransformM readerOptions woptions (unsafeCompiler . pandocTransform meta archive) -- pandocTransform meta archive definitions
                     >>= loadAndApplyTemplate "static/templates/default.html" (postCtx tags)
                     >>= imgUrls

             tagsRules tags $ \tag pattern -> do
                 let title = "Tag: " ++ tag
                 route idRoute
                 compile $ tagPage tags title pattern

             -- handle the simple static non-.page files; we define this after the pages because the pages' compilation has side-effects which may create new static files (archives & downsized images)
             let static = route idRoute >> compile symlinkFileCompiler -- WARNING: custom optimization requiring forked Hakyll installation; see https://github.com/jaspervdj/hakyll/issues/786
             version "static" $ mapM_ (`match` static) [
                                     "docs/**",
                                     "images/**",
                                     "**.hs",
                                     "**.sh",
                                     "**.txt",
                                     "**.html",
                                     "**.page",
                                     "**.css",
                                     "**.R",
                                     "**.svg",
                                     "**.png",
                                     "**.jpg",
                                     -- skip "static/build/**" because of the temporary files
                                     "static/css/**",
                                     "static/font/**",
                                     "static/img/**",
                                     "static/nginx/**",
                                     "static/redirects/**",
                                     "static/templates/**",
                                     "static/**.conf",
                                     "static/**.css",
                                     "static/**.gif",
                                     "static/**.git",
                                     "static/**.gitignore",
                                     "static/**.hs",
                                     "static/**.html",
                                     "static/**.ico",
                                     "static/**.js",
                                     "static/**.net",
                                     "static/**.png",
                                     "static/**.png-768px",
                                     "static/**.R",
                                     "static/**.sh",
                                     "static/**.svg",
                                     "static/**.ttf",
                                     "static/**.otf",
                                     "**.yaml",
                                     "metadata/**",
                                     "atom.xml", -- copy stub of deprecated RSS feed
                                     "index"]

             match "static/templates/*.html" $ compile templateCompiler

             match "static/css/initial.css"   $ compile cssTemplateCompiler -- to substitute in 'initial.css' while maintaining an easily-edited separate file
             -- The dark mode setup:
             -- 1. `colors.css` and `dark-mode-adjustments.css` are the files we actually edit.
             -- 2. `colors-dark.css` is generated from `colors.css` via `color-scheme-convert.php`.
             -- 3. Then `colors-dark.css` is concatenated with `dark-mode-adjustments.css` to generate `dark-mode.css` (remember to escape '$'!)
             match "static/css/colors.css"    $ compile cssTemplateCompiler
             match "static/css/dark-mode.css" $ compile cssTemplateCompiler

-- https://kyle.marek-spartz.org/posts/2014-12-09-hakyll-css-template-compiler.html
cssTemplateCompiler :: Compiler (Item Template)
cssTemplateCompiler = cached "Hakyll.Web.Template.cssTemplateCompiler" $
    fmap (readTemplate . compressCss) <$> getResourceString

woptions :: WriterOptions
woptions = defaultHakyllWriterOptions{ writerSectionDivs = True,
                                       writerTableOfContents = True,
                                       writerColumns = 130,
                                       writerTemplate = Just tocTemplate,
                                       writerTOCDepth = 4,
                                       -- we use MathJax directly to bypass Texmath; this enables features like colored equations:
                                       -- https://docs.mathjax.org/en/latest/input/tex/extensions/color.html http://mirrors.ctan.org/macros/latex/required/graphics/color.pdf#page=4 eg "Roses are $\color{red}{\text{beautiful red}}$, violets are $\color{blue}{\text{lovely blue}}$" or "${\color{red} x} + {\color{blue} y}$"
                                       writerHTMLMathMethod = MathJax defaultMathJaxURL,
                                       writerEmailObfuscation = NoObfuscation }
   where
    -- below copied from https://github.com/jaspervdj/hakyll/blob/e8ed369edaae1808dffcc22d1c8fb1df7880e065/web/site.hs#L73 because god knows I don't know what this type bullshit is either:
    -- "When did it get so hard to compile a string to a Pandoc template?"
    tocTemplate =
        either error id $ either (error . show) id $
        runPure $ runWithDefaultPartials $
        compileTemplate "" "<div id=\"TOC\">$toc$</div>\n<div id=\"markdownBody\">$body$</div>"

postList :: Tags -> Pattern -> ([Item String] -> Compiler [Item String]) -> Compiler String
postList tags pattern preprocess' = do
    postItemTemplate <- loadBody "static/templates/postitem.html"
    posts' <- loadAll pattern
    posts <- preprocess' posts'
    applyTemplateList postItemTemplate (postCtx tags) posts
tagPage :: Tags -> String -> Pattern -> Compiler (Item String)
tagPage tags title pattern = do
    list <- postList tags pattern (return . id)
    makeItem ""
        >>= loadAndApplyTemplate "static/templates/tags.html"
                (constField "posts" list <> constField "title" title <>
                    defaultContext)

imgUrls :: Item String -> Compiler (Item String)
imgUrls item = do
    rte <- getRoute $ itemIdentifier item
    case rte of
        Nothing -> return item
        Just _  -> traverse (unsafeCompiler . addImgDimensions) item

postCtx :: Tags -> Context String
postCtx tags =
    tagsField "tagsHTML" tags <>
    descField "description" <> -- constField "description" "N/A" <>
    -- NOTE: as a hack to implement conditional loading of JS/metadata in /index, in default.html, we switch on an 'index' variable; this variable *must* be left empty (and not set using `constField "index" ""`)!
    -- similarly, 'author': default.html has a conditional to set 'Gwern Branwen' as the author in the HTML metadata if 'author' is not defined, but if it is, then the HTML metadata switches to the defined author & the non-default author is exposed in the visible page metadata as well for the human readers.
    defaultContext <>
    dateField "created" "%F" <>
    -- if no manually set last-modified time, fall back to checking file modification time:
    dateField "modified" "%F" <>
    modificationTimeField "modified" "%F" <>
    -- page navigation defaults:
    constField "next" "/index" <>
    constField "previous" "/index" <>
    -- metadata:
    constField "description" "N/A" <>
    constField "status" "notes" <>
    constField "confidence" "log" <>
    constField "importance" "0" <>
    constField "cssExtension" "drop-caps-de-zs" <>
    constField "thumbnail" "/static/img/logo/logo-whitebg-large-border.png" <>
    -- for use in templating, `<body class="$safeURL$">`, allowing page-specific CSS:
    escapedTitleField "safeURL"
  where escapedTitleField t = (mapContext (map toLower . filter isLetter . takeBaseName) . pathField) t
        descField d = field d $ \item -> do
                          metadata <- getMetadata (itemIdentifier item)
                          let desc = fromMaybe "N/A" $ lookupString d metadata
                          let cleanedDesc = runPure $ do
                                   pandocDesc <- readMarkdown def{readerExtensions=pandocExtensions} (T.pack desc)
                                   htmlDesc <- writeHtml5String def pandocDesc
                                   return $ T.unpack htmlDesc
                           in case cleanedDesc of
                              Left _          -> return "N/A"
                              Right finalDesc -> return $ reverse $ drop 4 $ reverse $ drop 3 finalDesc -- strip <p></p>


-- pandocTransform :: Metadata -> ArchiveMetadata -> (M.Map String String) -> Pandoc -> IO Pandoc
-- pandocTransform md adb dict = walkM (\x -> annotateLink md x >>= localizeLink adb) . walk smallcapsfy . walk headerSelflink . annotateFirstDefinitions . walkInlineM (defineAbbreviations dict) . bottomUp mergeSpaces . walk (map (nominalToRealInflationAdjuster . marginNotes . convertInterwikiLinks . addAmazonAffiliate))

pandocTransform :: Metadata -> ArchiveMetadata -> Pandoc -> IO Pandoc
pandocTransform md adb = walkM (\x -> annotateLink md x >>= localizeLink adb >>= imageSrcset >>= invertImageInline) . typographyTransform . walk headerSelflink . walk (map (nominalToRealInflationAdjuster . marginNotes . convertInterwikiLinks . addAmazonAffiliate))

-- Example: Image ("",["full-width"],[]) [Str "..."] ("/images/gan/thiswaifudoesnotexist.png","fig:")
-- type Text.Pandoc.Definition.Attr = (T.Text, [T.Text], [(T.Text, T.Text)])
imageSrcset :: Inline -> IO Inline
imageSrcset (Image (c, t, pairs) inlines (target, title)) =
  do let ext = takeExtension $ T.unpack target
     let target' = T.unpack target
     (_,w) <- imageMagickDimensions $ tail target'

     let smallerPath = (tail target')++"-768px"++ext
     notExist <- fmap not $ doesFileExist smallerPath
     when notExist $ do
       (status,_,bs) <-  runShellCommand "./" Nothing "convert" [tail target', "-resize", "768x768", smallerPath]
       case status of
         ExitFailure _ -> error $ show status ++ show bs
         _ -> do if ext == ".png" then -- lossily optimize using my pngnq/mozjpeg scripts:
                     void $ runShellCommand "./" Nothing "/home/gwern/bin/bin/png" [smallerPath]
                   else
                     void $ runShellCommand "./" Nothing "/home/gwern/bin/bin/compressJPG" [smallerPath]
                 void $ print ("Created smaller image: " ++ smallerPath)
     let srcset = T.pack ("/"++smallerPath++" 768w, " ++ target'++" "++w++"w")
     return $ Image (c, t, pairs++[("srcset", srcset), ("sizes", T.pack ("(max-width: 768px) 100vw, "++w++"px"))])
                    inlines (target, title)
imageSrcset x = return x

-- For Amazon links, there are two scenarios: there are parameters (denoted by a
-- '?' in the URL), or there are not. In the former, we need to append the tag as
-- another item ('&tag='), while in the latter, we need to set up our own
-- parameter ('?tag='). The transform may be run many times since
-- they are supposed to be pure, so we
-- need to also check a tag hasn't already been appended.
--
-- For non-Amazon links, we just return them unchanged.
addAmazonAffiliate :: Inline -> Inline
addAmazonAffiliate x@(Link attr r (l, t)) = if (("www.amazon.com/" `T.isInfixOf` l) && not ("tag=gwernnet-20" `T.isInfixOf` l)) then
                                        if ("?" `T.isInfixOf` l) then Link attr r (l `T.append` "&tag=gwernnet-20", t) else Link attr r (l `T.append` "?tag=gwernnet-20", t)
                                       else x
addAmazonAffiliate x = x

-- | Make headers into links to themselves, so they can be clicked on or copy-pasted easily.
headerSelflink :: Block -> Block
headerSelflink (Header a (href,b,c) d) = Header a (href,b,c) [Link nullAttr d ("#"`T.append`href, "Link to section: § '"`T.append`inlinesToString(d)`T.append`"'")]
headerSelflink x = x

-- FASTER HTML RENDERING BY STATICLY SPECIFYING ALL IMAGE DIMENSIONS
-- read HTML string with TagSoup, process `<img>` tags to read the file's dimensions, and hardwire them;
-- this optimizes HTML rendering since browsers know before downloading the image how to layout the page.
-- Further, specify 'lazy-loading' for all images: the lazy attribute was introduced by Chrome 76 ~August 2019, and adopted by Firefox 75 ~February 2020 (https://bugzilla.mozilla.org/show_bug.cgi?id=1542784), standardized as https://html.spec.whatwg.org/multipage/urls-and-fetching.html#lazy-loading-attributes with >63% global availability + backwards compatibility (https://www.caniuse.com/#feat=loading-lazy-attr https://github.com/whatwg/html/pull/3752  https://web.dev/native-lazy-loading/).
-- Pandoc feature request to push the lazy loading upstream: https://github.com/jgm/pandoc/issues/6197
addImgDimensions :: String -> IO String
addImgDimensions = fmap (renderTagsOptions renderOptions{optMinimize=whitelist, optRawTag = (`elem` ["script", "style"]) . map toLower}) . mapM staticImg . parseTags
                 where whitelist s = s /= "div" && s /= "script" && s /= "style"


{- example illustration:
 TagOpen "img" [("src","/images/201201-201207-traffic-history.png")
                ("alt","Plot of page-hits (y-axis) versus date (x-axis)")],
 TagOpen "figcaption" [],TagText "Plot of page-hits (y-axis) versus date (x-axis)",
 TagClose "figcaption",TagText "\n",TagClose "figure" -}
staticImg :: Tag String -> IO (Tag String)
staticImg (TagOpen "img" xs) |
  Nothing <- lookup "height" xs,
  Nothing <- lookup "width" xs,
  Just p <- lookup "src" xs,
  "/" `isPrefixOf` p && (takeExtension p /= ".svg") && not ("data:image/" `isPrefixOf` p) = do
    let p' = if head p == '/' then tail p else p
    (height,width) <- imageMagickDimensions p' `onException` (putStrLn p)
    -- body max-width is 1600 px, sidebar is 150px, so any image wider than ~1400px
    -- will wind up being reflowed by the 'img { max-width: 100%; }' responsive-image CSS declaration;
    -- let's avoid that specific case by lying about its width, although this doesn't fix all the reflowing.
    -- No images should be more than a screen in height either, so we'll set a maximum of 1400
    let width' =  show ((read width::Int) `min` 1400)
    let height' = show ((read height::Int) `min` 1400)
    return (TagOpen "img" (uniq ([("loading", "lazy"), -- lazy load all images (upcoming feature in Chrome)
                                   ("height", height'), ("width", width')]++xs)))
  where uniq = nub . sort
staticImg x = return x

-- INTERWIKI PLUGIN
-- This is a simplification of the original interwiki plugin I wrote for Gitit: <https://github.com/jgm/gitit/blob/master/plugins/Interwiki.hs>
-- It's more or less the same thing, but the interwiki mapping is cut down to only the ones I use, and it avoids a dependency on Gitit.
-- | Convert a list of inlines into a string.
inlinesToString :: [Inline] -> T.Text
inlinesToString = T.concat . map go
  where go x = case x of
               -- reached the literal T.Text:
               Str s    -> s
               -- strip & recurse on the [Inline]:
               Emph        x' -> inlinesToString x'
               Underline   x' -> inlinesToString x'
               Strong      x' -> inlinesToString x'
               Strikeout   x' -> inlinesToString x'
               Superscript x' -> inlinesToString x'
               Subscript   x' -> inlinesToString x'
               SmallCaps   x' -> inlinesToString x'
               -- throw away attributes and recurse on the [Inline]:
               Span _      x' -> inlinesToString x' -- eg [foo]{.smallcaps} -> foo
               Quoted _    x' -> inlinesToString x'
               Cite _      x' -> inlinesToString x'
               Link _   x' _  -> inlinesToString x'
               Image _  x' _  -> inlinesToString x'
               -- throw away attributes, return the literal T.Text:
               Math _      x' -> x'
               RawInline _ x' -> x'
               Code _      x' -> x'
               -- fall through with a blank:
               _        -> " "::T.Text
convertInterwikiLinks :: Inline -> Inline
convertInterwikiLinks x@(Link attr ref (interwiki, article)) =
  if T.head interwiki == '!' then
        case M.lookup (T.tail interwiki) interwikiMap of
                Just url  -> case article of
                                  "" -> Link attr ref (url `interwikiurl` inlinesToString ref, "") -- tooltip is now handled by LinkMetadata.hs
                                  _  -> Link attr ref (url `interwikiurl` article, "")
                Nothing -> error $ "Attempted to use an interwiki link with no defined interwiki: " ++ show x
  else x
            where -- 'https://starwars.wikia.com/wiki/Emperor_Palpatine'
                  interwikiurl u a = u `T.append` T.pack (replace "%20" "_" $ replace "%23" "#" $ urlEncode (deunicode (T.unpack a)))
                  deunicode = map (\c -> if c == '’' then '\'' else c)
convertInterwikiLinks x = x
-- | Large table of constants; this is a mapping from shortcuts to a URL. The URL can be used by
--   appending to it the article name (suitably URL-escaped, of course).
interwikiMap :: M.Map T.Text T.Text
interwikiMap = M.fromList $ wpInterwikiMap ++ customInterwikiMap
wpInterwikiMap, customInterwikiMap :: [(T.Text, T.Text)]
customInterwikiMap = [("Hackage", "https://hackage.haskell.org/package/"),
                      ("Hawiki", "https://haskell.org/haskellwiki/"),
                      ("Hoogle", "https://www.haskell.org/hoogle/?hoogle="),
                      -- shortcuts
                      ("W", "https://en.wikipedia.org/wiki/"),
                      ("WP", "https://en.wikipedia.org/wiki/")]
wpInterwikiMap = [("Wikipedia", "https://en.wikipedia.org/wiki/"),
                  ("Wikiquote", "https://en.wikiquote.org/wiki/"),
                  ("Wiktionary", "https://en.wiktionary.org/wiki/")]

-- https://edwardtufte.github.io/tufte-css/#sidenotes
-- support Tufte-CSS-style margin notes with a syntax like
-- 'Foo bar.^[!Margin: Short explanation.] Baz quux burble...'
--
-- > marginNotes (Note [Para [Str "!Margin:", Space, Str "Test."]])
-- → Span ("",["marginnote"],[]) [Para [Space, Str "Test."]]
--
-- This sets a 'marginnote' HTML class on the footnote anchor. `sidenotes.js` specially supports these and renders them differently, removing the numerals. We strip the 'Note' because otherwise it will get a number despite being hidden, and that's confusing.
-- Margin notes can be used for general comments on a region of text which aren't intended to refer to a specific word or sentence, and avoiding spurious precision makes it a little easier for the reader.
-- I intend to experiment with them as a way to summarize paragraphs in a short sentence, somewhat like http://www.pgbovine.net/PhD-memoir/pguo-PhD-grind.pdf or how https://ebooks.adelaide.edu.au/c/coleridge/samuel_taylor/rime/#part1 glosses each section of verse, which can be a little tricky to follow.
marginNotes :: Inline -> Inline
marginNotes x@(Note (bs:cs)) =
  case bs of
    Para ((Str m):ms) -> if not ("!Margin:" == m) then x else
                            Span ("", ["marginnote"], []) (blocksToInlines $ (Para ms):cs)
    _ -> x
marginNotes x = x
