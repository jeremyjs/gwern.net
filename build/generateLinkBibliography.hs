#!/usr/bin/env runghc
{-# LANGUAGE OverloadedStrings #-}
module Main where

-- Generate "link bibliographies" for Gwern.net pages.
--
-- Link bibliographies are similar to directory indexes in compiling a list of all links on a
-- Gwern.net page/essay, in order, with their annotations (where available). They are the
-- forward-citation dual of backlinks, are much easier to synoptically browse than mousing over
-- links one at a time, and can help provide a static version of the page (ie. download page + link
-- bibliography to preserve the annotations).
--
-- Link bibliographies are generated by parsing each $PAGE (provided in default.html as '$url$'),
-- filtering for Links using the Pandoc API, querying the metadata, generating a numbered list of
-- links, and then writing out the generated Markdown file to 'docs/link-bibliography/$PAGE.page'.
-- They are compiled like normal pages by Hakyll, and they are exposed to readers as an additional
-- link in the page metadata block, paired with the backlinks.

import Control.Monad (when)
import Data.List (isPrefixOf, isSuffixOf, nub)
import Data.Text.Titlecase (titlecase)
import qualified Data.Map as M (lookup, keys)
import System.Environment (getArgs)
import System.FilePath (takeDirectory, takeFileName)
import System.IO (stderr, hPrint)

import Data.Text.IO as TIO (readFile)
import qualified Data.Text as T (pack, unpack)

import Control.Monad.Parallel as Par (mapM_)

import Text.Pandoc (Inline(Code, Link, Str, Space, Span), def, nullAttr, nullMeta, readMarkdown, readerExtensions, writerExtensions, runPure, pandocExtensions, writeMarkdown, ListNumberDelim(DefaultDelim), ListNumberStyle(DefaultStyle), Block(Header, Para, OrderedList), Pandoc(..), writeHtml5String)
import Text.Pandoc.Walk (walk)

import LinkBacklink (getBackLink, getSimilarLink)
import LinkMetadata (generateAnnotationTransclusionBlock, readLinkMetadata, authorsTruncate, hasAnnotation, urlToAnnotationPath, Metadata, MetadataItem)
import Query (extractURLs, extractLinks)
import Typography (identUniquefy)
import Utils (writeUpdatedFile, replace)

main :: IO ()
main = do pages <- getArgs
          md <- readLinkMetadata
          -- build the full link-bib pages for top-level pages/essays; these are full Markdown pages which are compiled like regular pages, and can be popped up:
          Par.mapM_ (generateLinkBibliography md) pages
          -- build HTML fragments for each annotation link, containing just the list and no header/full-page wrapper, so they are nice to transclude *into* popups:
          Par.mapM_ (writeAnnotationLinkBibliographyFragment md) $ M.keys md

generateLinkBibliography :: Metadata -> String -> IO ()
generateLinkBibliography md page = do links <- extractLinksFromPage page
                                      backlinks    <- mapM (fmap snd . getBackLink) links
                                      similarlinks <- mapM (fmap snd . getSimilarLink) links
                                      let pairs = linksToAnnotations md links
                                          pairs' = zipWith3 (\(a,b) c d -> (a,b,c,d)) pairs backlinks similarlinks
                                          body = Header 1 nullAttr [Str "Link Bibliography"] :
                                                 [generateLinkBibliographyItems pairs']
                                          document = Pandoc nullMeta body
                                          markdown = runPure $ writeMarkdown def{writerExtensions = pandocExtensions} $
                                            walk identUniquefy $ walk (hasAnnotation md) document -- global rewrite to de-duplicate all of the inserted URLs
                                      case markdown of
                                        Left e   -> hPrint stderr e
                                        -- compare with the old version, and update if there are any differences:
                                        Right p' -> do let contentsNew = generateYAMLHeader (replace ".page" "" page) ++ T.unpack p' ++ "\n\n"
                                                       writeUpdatedFile "link-bibliography" ("docs/link-bibliography/" ++ page) (T.pack contentsNew)

generateYAMLHeader :: FilePath -> String
generateYAMLHeader d = "---\n" ++
                       "title: " ++ d ++ " (Link Bibliography)\n" ++
                       "description: 'Annotated bibliography of links in the top-level page \"" ++ d ++ "\"'\n" ++
                       "created: 2009-01-01\n" ++
                       "status: in progress\n" ++
                       "confidence: log\n" ++
                       "importance: 0\n" ++
                       "cssExtension: drop-caps-de-zs\n" ++
                       "index: true\n" ++
                       "...\n" ++
                       "\n"

generateLinkBibliographyItems :: [(String,MetadataItem,FilePath,FilePath)] -> Block
generateLinkBibliographyItems [] = Para []
generateLinkBibliographyItems items = OrderedList (1, DefaultStyle, DefaultDelim) $ map generateLinkBibliographyItem items
generateLinkBibliographyItem  :: (String,MetadataItem,FilePath,FilePath) -> [Block]
generateLinkBibliographyItem (f,(t,aut,_,_,_,""),_,_)  = -- short:
  let f'
        | "http" `isPrefixOf` f = f
        | "index" `isSuffixOf` f = takeDirectory f
        | otherwise = takeFileName f
      authorShort = authorsTruncate aut
      authorSpan  = if authorShort/=aut then Span ("",["full-authors-list"],[("title", T.pack aut)]) [Str (T.pack $ authorsTruncate aut)]
                    else Str (T.pack authorShort)
      author = if aut=="" || aut=="N/A" then []
               else
                 [Str ",", Space, authorSpan]
      -- I skip date because files don't usually have anything better than year, and that's already encoded in the filename which is shown
  in
    let linkAttr = if "https://en.wikipedia.org/wiki/" `isPrefixOf` f then ("",["include-annotation", "include-spinner-not"],[]) else nullAttr
    in
    if t=="" then
      [Para (Link linkAttr [Code nullAttr (T.pack f')] (T.pack f, "") : author)]
    else
      [Para (Code nullAttr (T.pack f') :
              Str ":" : Space :
              Link linkAttr [Str "“", Str (T.pack $ titlecase t), Str "”"] (T.pack f, "") : author)]
-- long items:
generateLinkBibliographyItem (f,a,bl,sl) = generateAnnotationTransclusionBlock (f,a) bl sl ""

extractLinksFromPage :: String -> IO [String]
extractLinksFromPage path = do f <- TIO.readFile path
                               let pE = runPure $ readMarkdown def{readerExtensions=pandocExtensions} f
                               return $ case pE of
                                          Left  _ -> []
                                          -- make the list unique, but keep the original ordering
                                          Right p -> map (replace "https://www.gwern.net/" "/") $
                                                     filter (\l -> head l /= '#') $ -- self-links are not useful in link bibliographies
                                                     nub $ map T.unpack $ extractURLs p -- TODO: maybe extract the title from the metadata for nicer formatting?

linksToAnnotations :: Metadata -> [String] -> [(String,MetadataItem)]
linksToAnnotations m = map (linkToAnnotation m)
linkToAnnotation :: Metadata -> String -> (String,MetadataItem)
linkToAnnotation m u = case M.lookup u m of
                         Just i  -> (u,i)
                         Nothing -> (u,("","","","",[],""))

-- don't waste the user's time if the annotation is not heavily linked, as most are not, or if all the links are WP links:
mininumLinkBibliographyFragment :: Int
mininumLinkBibliographyFragment = 3

writeAnnotationLinkBibliographyFragment :: Metadata -> FilePath -> IO ()
writeAnnotationLinkBibliographyFragment md path =
  case M.lookup path md of
       Nothing -> return ()
       Just (_,_,_,_,_,"") -> return ()
       Just (_,_,_,_,_,abstract) -> do
        let links = filter (\l -> not (takeWhile (/='#') path `isPrefixOf` l)) $ -- delete self-links, such as in the ToC of scraped abstracts
              map T.unpack $ extractLinks False (T.pack abstract)
        when (length (filter (\l -> not ("https://en.wikipedia.org/wiki/" `isPrefixOf` l))  links) >= mininumLinkBibliographyFragment) $
          do backlinks    <- mapM (fmap snd . getBackLink) links
             similarlinks <- mapM (fmap snd . getSimilarLink) links
             let pairs = linksToAnnotations md links
                 pairs' = zipWith3 (\(a,b) c d -> (a,b,c,d)) pairs backlinks similarlinks
                 body = [generateLinkBibliographyItems pairs']
                 document = Pandoc nullMeta body
                 html = runPure $ writeHtml5String def{writerExtensions = pandocExtensions} $
                   walk (hasAnnotation md) document
             case html of
               Left e   -> hPrint stderr e
               -- compare with the old version, and update if there are any differences:
               Right p' -> writeUpdatedFile "linkbibliography-fragment" ("docs/link-bibliography/" ++ urlToAnnotationPath path) p'
