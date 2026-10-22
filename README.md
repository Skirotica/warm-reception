# Warm Reception

Warm Reception is a partner console for Black Gavel. It watches company news, decides whether a company is worth outreach, and drafts a sequence a human still has to approve. Nothing sends on its own.

This repository is also the Agentic AI Capstone Develop kit that the prototype was built from. If you are a student opening the course folder, start with [START_HERE.md](START_HERE.md). If you are looking at the product, the folders below are the map.

## What is where

| Folder | What it is |
|---|---|
| [index.html](index.html) | Class prototype. One file. Open it in a browser. Synthetic companies only. |
| [demo/](demo/) | GeeTM-branded demo of the same console. |
| [live/](live/) | Partner Live app. This is the screen partners use. |
| [prod-api/](prod-api/) | Cloudflare Worker that holds the API keys and the private store. |
| [exa-proxy/](exa-proxy/) | Older Exa search proxy. Live now calls `prod-api` instead. |
| [hunter-proxy/](hunter-proxy/) | Older Hunter.io proxy. Live now calls `prod-api` instead. |
| [data/](data/) | Synthetic companies, contacts, events, and eval cases for the class prototype. |
| [policies/](policies/) | The rules the agent follows: who qualifies, what to draft, when to stop. |
| [design/](design/) | Locked colors, type, and the three skins. |

`deploy-companion/` is a local course kit and is not published to GitHub.

## The human gate

A partner clicks Approve, Edit, or Escalate before any outreach package is treated as authorized. Confirm No-Go is what removes an unconfirmed No-go from the live queue. A news-site husk that is not a real company can still be dropped.

## Keys

API keys live as Cloudflare Worker secrets, or in the class prototype's settings field in the browser. They are never written into these files.
