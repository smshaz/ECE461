import simpleGit from 'simple-git';
import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';

const GITHUB_API_URL = 'https://api.github.com/repos'; // GitHub API endpoint for repository data
const NPM_REGISTRY_URL = 'https://registry.npmjs.org/'; // NPM registry endpoint for package data
const PER_PAGE = 100; // GitHub API truncates certain number of contributors
const GITHUB_TOKEN = process.env.GITHUB_TOKEN; // GitHub personal access token for authentication

export async function getBusFactor(url: string): Promise<number> {
  const repoPath = url.replace('https://github.com/', ''); // Extract the repository path from the provided GitHub URL
  let totalContributors = 0;
  let page = 1; // Start with the first page of results as github API truncates to 100 users per page

  try {
    // Loop through all available contributor pages from the GitHub API
    while (true) {
      // Send a GET request to the GitHub API to fetch contributors for the current page
      const response = await axios.get(`${GITHUB_API_URL}/${repoPath}/contributors`, {
        params: {
          per_page: PER_PAGE, // Request up to 100 contributors at a time (GitHub API limit)
          page: page, // Request the current page of contributors
        },
        headers: { 'Accept': 'application/vnd.github.v3+json' }, // Use the latest version of the GitHub API
      });

      const contributors = response.data; // Extract contributor data from the API response
      totalContributors += contributors.length; // Add the number of contributors on this page to the total count

      // If we get fewer contributors than the maximum allowed per page, we've reached the last page
      if (contributors.length < PER_PAGE) {
        break; // Exit the loop when no more pages of contributors are available
      }

      page++; // Increment the page number to fetch the next set of contributors
    }

    // Calculate the Bus Factor based on the total number of contributors
    let busFactorScore: number;
    if (totalContributors === 1) {
      busFactorScore = 0.1;
    } else if (totalContributors === 2) {
      busFactorScore = 0.2;
    } else if (totalContributors <= 4) {
      busFactorScore = 0.3;
    } else if (totalContributors <= 8) {
      busFactorScore = 0.4;
    } else if (totalContributors <= 16) {
      busFactorScore = 0.5;
    } else if (totalContributors <= 32) {
      busFactorScore = 0.6;
    } else if (totalContributors <= 64) {
      busFactorScore = 0.7;
    } else if (totalContributors <= 128) {
      busFactorScore = 0.8;
    } else if (totalContributors <= 256) {
      busFactorScore = 0.9;
    } else {
      busFactorScore = 1.0;
    }

    return busFactorScore; // Return the calculated Bus Factor score
  } catch (error: any) {
    // Handle any errors that occur during the API request
    console.error(`Error fetching contributors for GitHub repo ${url}:`, error.message);
    return -1; // Return -1 to indicate failure
  }
}


// Function to clone a GitHub repository locally using simple-git
export async function cloneRepo(url: string, localPath: string): Promise<void> {
  const git = simpleGit(); // Create an instance of simple-git for performing git operations
  try {
    await git.clone(url, localPath); // Clone the GitHub repository into the specified local directory
  } catch (error: any) {
    //console.error(`Error cloning repo: ${error.message}`); // Log any errors that occur during cloning
  }
}

// Function to count Source Lines of Code (SLOC) and comments in a file (first 100 lines)
function countSlocAndCommentsLimited(fileContent: string): { sloc: number, comments: number } {
  const lines = fileContent.split('\n').slice(0, 100); // Limit to first 100 lines
  let sloc = 0;
  let comments = 0;
  let inBlockComment = false;

  for (const line of lines) {
    const trimmedLine = line.trim();

    // Handle block comments (/* ... */)
    if (inBlockComment) {
      comments++;
      if (trimmedLine.endsWith('*/')) {
        inBlockComment = false;
      }
    } else if (trimmedLine.startsWith('//')) {
      comments++; // Single-line comment
    } else if (trimmedLine.startsWith('/*')) {
      comments++;
      inBlockComment = !trimmedLine.endsWith('*/');
    } else if (trimmedLine.length > 0) {
      sloc++; // Count lines of code
    }
  }

  return { sloc, comments };
}

// Function to walk through a directory and process only .js or .ts files
async function walkDirectoryLimited(dir: string, fileCallback: (filePath: string) => void) {
  const files = fs.readdirSync(dir);

  for (const file of files) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory()) {
      await walkDirectoryLimited(fullPath, fileCallback);
    } else if (file.endsWith('.ts') || file.endsWith('.js')) {
      fileCallback(fullPath);
    }
  }
}

// Function to read the README file and extract words and non-GitHub/npm links
function processReadme(readmeContent: string) {
  const wordCount = readmeContent.split(/\s+/).length;
  const nonGitHubLinks = readmeContent.match(/https?:\/\/(?!github\.com|npmjs\.com)[^\s]+/g) || [];

  // console.log(`README word count: ${wordCount}`);
  // console.log(`Non-GitHub/npm links: ${nonGitHubLinks.length}`);
}

// Function to calculate the "Ramp Up" metric
export async function calculateRampUpMetric(localPath: string): Promise<{ sloc: number, comments: number, ratio: number }> {
  let totalSloc = 0;
  let totalComments = 0;

  // Walk through JavaScript and TypeScript files
  await walkDirectoryLimited(localPath, (filePath) => {
    const fileContent = fs.readFileSync(filePath, 'utf8');
    const { sloc, comments } = countSlocAndCommentsLimited(fileContent);
    totalSloc += sloc;
    totalComments += comments;
  });

  const ratio = totalComments / totalSloc;
  const repoName = path.basename(localPath);

  // console.log(`Repository: ${repoName}`);
  // console.log(`SLOC: ${totalSloc}, Comments: ${totalComments}, Ratio: ${ratio}`);

  // Process README file if it exists
  const readmePath = path.join(localPath, 'README.md');
  if (fs.existsSync(readmePath)) {
    const readmeContent = fs.readFileSync(readmePath, 'utf8');
    processReadme(readmeContent);
  } else {
    // console.log('No README file found.');
  }

  return { sloc: totalSloc, comments: totalComments, ratio };
}


export async function checkLicenseCompatibility(url: string): Promise<{ score: number, details: string }> {

  if (!GITHUB_TOKEN) {
    //GitHub token is not set. Set the GITHUB_TOKEN environment variable!!!!!!!!!!!!!!
    return { score: 0, details: 'GitHub token not set' };
  }

  const headers = {
    'Accept': 'application/vnd.github.v3+json',
    'Authorization': `token ${GITHUB_TOKEN}`,
    'User-Agent': 'Your-App-Name'
  };

  try {
    let repoPath;
    if (url.startsWith('https://www.npmjs.com/package/')) {
      const packageName = url.replace('https://www.npmjs.com/package/', '');
      const npmResponse = await axios.get(`${NPM_REGISTRY_URL}${packageName}`);
      const repository = npmResponse.data.repository;
      if (repository && repository.url) {
        repoPath = repository.url
          .replace('git+https://github.com/', '')
          .replace('git://github.com/', '')
          .replace('https://github.com/', '')
          .replace('.git', '');
      } else {
        return { score: 0, details: 'No GitHub repository found for npm package' };
      }
    } else {
      repoPath = url.replace('https://github.com/', '');
    }

    let licenseInfo = '';

    // Check LICENSE file
    try {
      const licenseResponse = await axios.get(`${GITHUB_API_URL}/${repoPath}/contents/LICENSE`, { headers });
      licenseInfo = Buffer.from(licenseResponse.data.content, 'base64').toString('utf-8');
    } catch (error) {
        //console.log(`LICENSE file not found for repository ${repoPath}, checking package.json...`);
      
      // Check package.json
      try {
        const packageJsonResponse = await axios.get(`${GITHUB_API_URL}/${repoPath}/contents/package.json`, { headers });
        const packageJsonContent = JSON.parse(Buffer.from(packageJsonResponse.data.content, 'base64').toString('utf-8'));
        licenseInfo = packageJsonContent.license || '';
      } catch (error) {
        console.log('package.json not found or does not contain license information');
      }
    }

    // If still no license info, check README
    if (!licenseInfo) {
      const readmeResponse = await axios.get(`${GITHUB_API_URL}/${repoPath}/readme`, { headers });
      const readmeContent = Buffer.from(readmeResponse.data.content, 'base64').toString('utf-8');
      licenseInfo = extractLicenseFromReadme(readmeContent) || '';
    }

    if (licenseInfo) {
      const compatible = isCompatibleWithLGPLv2_1(licenseInfo);
      return {
        score: compatible ? 1 : 0,
        details: `License found: ${licenseInfo.split('\n')[0]}. Compatible: ${compatible}`
      };
    }

    return { score: 0, details: 'No license information found' };
  } catch (error: any) {
    console.error(`Error checking license: ${error.message}`);
    return { score: 0, details: `Error checking license: ${error.message}` };
  }
}

function extractLicenseFromReadme(content: string): string | null {
  const licenseRegex = /#+\s*License\s*([\s\S]*?)(?=#+|$)/i;
  const match = content.match(licenseRegex);
  return match ? match[1].trim() : null;
}

function isCompatibleWithLGPLv2_1(licenseText: string): boolean {
  const compatibleLicenses = [
    'LGPL-2.1', 'LGPL-3.0',
    'GPL-2.0', 'GPL-3.0',
    'MIT', 'BSD-2-Clause', 'BSD-3-Clause',
    'Apache-2.0', 'ISC', 'Unlicense'
  ];
  return compatibleLicenses.some(license => 
    licenseText.toLowerCase().includes(license.toLowerCase()) ||
    licenseText.toLowerCase().includes(license.toLowerCase().replace('-', ' '))
  );
}
