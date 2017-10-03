# content-finder
Module for finding main content on the HTML page. Adapted from Readability An Arc90 Lab Experiment.

## Installation
```npm install content-finder```

## Usage
```javascript

const contentFinder = require('content-finder');

var html = '<p>HTML source code of the website</p>';
var preserveUnlikelyCandidates = false;

var  cf = new contentFinder(preserveUnlikelyCandidates,html);
var html_content = cf.getArticleContent();
```
