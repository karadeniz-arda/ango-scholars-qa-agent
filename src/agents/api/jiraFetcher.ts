import dotenv from 'dotenv';

import {
    collectAcceptanceCriteriaSources,
    findAcceptanceCriteriaFields,
    type JiraAcceptanceCriteriaDiscovery,
} from './jira-acceptance-criteria.js';
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

        /*
         * JIRA_ACCEPTANCE_SOURCE_INGESTION_V1
         *
         * Jira custom-field IDs are instance-specific.
         * Discover Acceptance Criteria fields from Jira field
         * metadata and explicitly request their issue values.
         *
         * Discovery failure is not equivalent to confirmed
         * empty acceptance criteria. Preserve UNAVAILABLE so
         * downstream PASS eligibility can fail safe.
         */
        let acceptanceCriteriaDiscovery:
            JiraAcceptanceCriteriaDiscovery = {
                status: "UNAVAILABLE",
                candidateFieldCount: 0,
                sources: [],
            };

        try {
            const fieldsResponse = await fetch(
                `${baseUrl}/rest/api/3/field`,
                {
                    method: 'GET',
                    headers: {
                        'Authorization': `Basic ${authString}`,
                        'Accept': 'application/json'
                    }
                }
            );

            if (!fieldsResponse.ok) {
                throw new Error(
                    `Jira field metadata error: ` +
                    `${fieldsResponse.status} ` +
                    `${fieldsResponse.statusText}`
                );
            }

            const fields =
                await fieldsResponse.json();

            const candidateFields =
                findAcceptanceCriteriaFields(
                    fields
                );

            const candidateIds =
                candidateFields
                    .map((field) =>
                        String(
                            field?.id ?? ""
                        ).trim()
                    )
                    .filter(Boolean);

            let acceptanceIssueFields:
                Record<string, unknown> = {};

            if (candidateIds.length > 0) {
                const acceptanceFieldsResponse =
                    await fetch(
                        `${baseUrl}/rest/api/3/issue/${issueId}` +
                        `?fields=${encodeURIComponent(
                            candidateIds.join(",")
                        )}`,
                        {
                            method: 'GET',
                            headers: {
                                'Authorization':
                                    `Basic ${authString}`,
                                'Accept':
                                    'application/json'
                            }
                        }
                    );

                if (!acceptanceFieldsResponse.ok) {
                    throw new Error(
                        `Jira acceptance field read error: ` +
                        `${acceptanceFieldsResponse.status} ` +
                        `${acceptanceFieldsResponse.statusText}`
                    );
                }

                const acceptanceIssue =
                    await acceptanceFieldsResponse.json();

                acceptanceIssueFields =
                    acceptanceIssue?.fields ?? {};
            }

            const discovered =
                collectAcceptanceCriteriaSources(
                    fields,
                    acceptanceIssueFields
                );

            acceptanceCriteriaDiscovery = {
                status: "RESOLVED",
                candidateFieldCount:
                    discovered.candidateFieldCount,
                sources:
                    discovered.sources,
            };
        } catch (error) {
            console.warn(
                "Jira acceptance criteria field discovery unavailable:",
                error instanceof Error
                    ? error.message
                    : "unknown error"
            );
        }
        
        const issueDetails = {
            key: data.key,
            summary: data.fields.summary, 
            description: data.fields.description, 
            status: data.fields.status.name,
            acceptanceCriteriaDiscovery
        };

        return issueDetails;

    } catch (error) {
        console.error("Failed to fetch issue from Jira:", error);
        return null;
    }
}

