import dotenv from 'dotenv';
dotenv.config();

export async function getJiraIssue(issueId: string) {

    const baseUrl = process.env.JIRA_BASE_URL;
    const email = process.env.JIRA_EMAIL;
    const apiKey = process.env.JIRA_API_KEY;

    if (!baseUrl || !email || !apiKey) {
        throw new Error("Jira credentials (URL, Email, or API Key) are missing in .env file");
    }
    
    const authString = Buffer.from(`${email}:${apiKey}`).toString('base64');
    
    const endpoint = `${baseUrl}/rest/api/3/issue/${issueId}`;

    try {
        console.log(`Fetching details for Jira Issue: ${issueId}...`);
        
        const response = await fetch(endpoint, {
            method: 'GET',
            headers: {
                'Authorization': `Basic ${authString}`,
                'Accept': 'application/json'
            }
        });

        if (!response.ok) {
            const errorBody = await response.text();

            console.error("Jira endpoint:", endpoint);
            console.error("Jira response body:", errorBody);

            throw new Error(`Jira API Error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        
        const issueDetails = {
            key: data.key,
            summary: data.fields.summary, 
            description: data.fields.description, 
            status: data.fields.status.name
        };

        return issueDetails;

    } catch (error) {
        console.error("Failed to fetch issue from Jira:", error);
        return null;
    }
}

