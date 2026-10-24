import { Rpc } from '@opencode/plugin/rpc';
export const ProgressStatus=Rpc.define({id:'agent-progress-status',methods:{inspect:{input:{type:'object',additionalProperties:false},output:{type:'object',additionalProperties:true}}},events:{}});
