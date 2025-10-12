import { Injectable } from '@nestjs/common';
//import { InferenceClient } from '@huggingface/inference';
import { ConfigService } from '@nestjs/config';
import { ChatGroq } from '@langchain/groq';
import { ChatPromptTemplate } from '@langchain/core/prompts';

@Injectable()
export class ModelCallingService {
  //private hf: InferenceClient;
  

  constructor(private readonly configService: ConfigService) {
    //this.hf = new InferenceClient(this.configService.get('HF_ACCESS_TOKEN'));
  }
  
  async ask(prompt: string): Promise<string> {

    //create the model
    const model = new ChatGroq({
        model: "llama-3.1-8b-instant", 
      apiKey: this.configService.get("GROQ_API_KEY"),
      temperature: 0.5,
      maxTokens: 512,
    });

    //create the prompt
    const promptTemplate = ChatPromptTemplate.fromMessages([
      ['system', 'You are a helpful assistant.'],
      ['user', '{question}'],
    ]);

    //create the chain
    const chain = promptTemplate.pipe( model);

    //run the chain
    const message = await chain.invoke({ question: prompt });
    if (
      typeof message === 'object' &&
      message !== null &&
      'content' in message
    ) {
      
      return message.content?.toString();
    }
    throw new Error('Unexpected response from model chain');

//     // Option A: serverless chat on a public instruct model
//     const res = await this.hf.chatCompletion({
//       model: 'google/gemma-2-2b-it', // or 'microsoft/phi-4', 'mistralai/Mixtral-8x7B-Instruct-v0.1'
//       messages: [{ role: 'user', content: prompt }],
//       max_tokens: 512,
//     });
//     return res.choices?.[0]?.message?.content ?? '';
   }
}